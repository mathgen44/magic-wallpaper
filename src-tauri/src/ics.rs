//! Agendas au format iCalendar (.ics) : Google Agenda (« adresse secrète au format iCal »),
//! Outlook / Microsoft 365 (« publier un calendrier »), Nextcloud, Proton…
//!
//! Lecture des VEVENT, prise en charge des fuseaux horaires (IANA et noms Windows),
//! des événements sur la journée et des récurrences (RRULE, EXDATE, RECURRENCE-ID).

use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use rrule::{RRule, RRuleSet, Tz, Unvalidated};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Event {
    pub title: String,
    /// ms Unix
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub location: String,
    /// Indice de l'agenda dans la liste fournie.
    pub calendar: usize,
}

struct Prop {
    name: String,
    params: HashMap<String, String>,
    value: String,
}

/// Déplie les lignes (RFC 5545 §3.1) et découpe NOM;PARAM=V:valeur.
fn props(text: &str) -> Vec<Prop> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.lines() {
        if let Some(rest) = raw.strip_prefix(' ').or_else(|| raw.strip_prefix('\t')) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(raw.trim_end_matches('\r').to_string());
    }
    lines
        .into_iter()
        .filter_map(|l| {
            // Le ':' séparateur est le premier hors guillemets.
            let mut in_q = false;
            let idx = l.char_indices().find(|&(_, c)| {
                if c == '"' {
                    in_q = !in_q;
                }
                c == ':' && !in_q
            })?.0;
            let (head, value) = (&l[..idx], &l[idx + 1..]);
            let mut parts = head.split(';');
            let name = parts.next()?.to_ascii_uppercase();
            let params = parts
                .filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string())))
                .collect();
            Some(Prop { name, params, value: value.to_string() })
        })
        .collect()
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(x) => out.push(x),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Fuseau d'après TZID : nom IANA (éventuellement préfixé, ex. /mozilla.org/…/Europe/Paris)
/// ou nom Windows (Outlook).
pub fn parse_tz(tzid: &str) -> Option<Tz> {
    let t = tzid.trim();
    let windows = [
        ("Romance Standard Time", "Europe/Paris"),
        ("W. Europe Standard Time", "Europe/Berlin"),
        ("Central Europe Standard Time", "Europe/Budapest"),
        ("Central European Standard Time", "Europe/Warsaw"),
        ("GMT Standard Time", "Europe/London"),
        ("Greenwich Standard Time", "Atlantic/Reykjavik"),
        ("E. Europe Standard Time", "Europe/Chisinau"),
        ("FLE Standard Time", "Europe/Kiev"),
        ("GTB Standard Time", "Europe/Bucharest"),
        ("Eastern Standard Time", "America/New_York"),
        ("Central Standard Time", "America/Chicago"),
        ("Mountain Standard Time", "America/Denver"),
        ("Pacific Standard Time", "America/Los_Angeles"),
        ("Tokyo Standard Time", "Asia/Tokyo"),
        ("China Standard Time", "Asia/Shanghai"),
        ("India Standard Time", "Asia/Kolkata"),
        ("AUS Eastern Standard Time", "Australia/Sydney"),
        ("UTC", "UTC"),
        ("Coordinated Universal Time", "UTC"),
    ];
    if let Some((_, iana)) = windows.iter().find(|(w, _)| w.eq_ignore_ascii_case(t)) {
        return iana.parse::<chrono_tz::Tz>().ok().map(Tz::Tz);
    }
    let segs: Vec<&str> = t.split('/').filter(|s| !s.is_empty()).collect();
    (0..segs.len()).find_map(|i| segs[i..].join("/").parse::<chrono_tz::Tz>().ok().map(Tz::Tz))
}

fn resolve<T: TimeZone>(tz: &T, n: NaiveDateTime) -> Option<DateTime<T>> {
    match tz.from_local_datetime(&n) {
        LocalResult::Single(d) => Some(d),
        LocalResult::Ambiguous(a, _) => Some(a),
        LocalResult::None => tz.from_local_datetime(&(n + Duration::hours(1))).earliest(),
    }
}

/// Valeur DATE ou DATE-TIME → (instant dans son fuseau, journée entière ?).
fn parse_dt(p: &Prop) -> Option<(DateTime<Tz>, bool)> {
    let v = p.value.trim();
    let all_day = p.params.get("VALUE").is_some_and(|x| x.eq_ignore_ascii_case("DATE")) || v.len() == 8;
    if all_day {
        let d = NaiveDate::parse_from_str(&v[..8.min(v.len())], "%Y%m%d").ok()?;
        return resolve(&Tz::LOCAL, d.and_hms_opt(0, 0, 0)?).map(|d| (d, true));
    }
    if let Some(u) = v.strip_suffix('Z') {
        let n = NaiveDateTime::parse_from_str(u, "%Y%m%dT%H%M%S").ok()?;
        return Some((Tz::UTC.from_utc_datetime(&n), false));
    }
    let n = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    let tz = p.params.get("TZID").and_then(|t| parse_tz(t)).unwrap_or(Tz::LOCAL);
    resolve(&tz, n).map(|d| (d, false))
}

/// Durée ISO 8601 (DURATION:PT1H30M, P1D…).
fn parse_duration(s: &str) -> Option<Duration> {
    let s = s.trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.trim_start_matches('+')),
    };
    let s = s.strip_prefix('P')?;
    let mut total = Duration::zero();
    let mut num = String::new();
    let mut in_time = false;
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += match (c, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(if neg { -total } else { total })
}

#[derive(Default)]
struct Raw {
    uid: String,
    title: String,
    location: String,
    start: Option<(DateTime<Tz>, bool)>,
    end: Option<(DateTime<Tz>, bool)>,
    duration: Option<Duration>,
    rrule: Option<String>,
    exdates: Vec<DateTime<Tz>>,
    recurrence_id: Option<DateTime<Tz>>,
    cancelled: bool,
}

/// Nom de l'agenda (X-WR-CALNAME) s'il est fourni.
pub fn calendar_name(text: &str) -> Option<String> {
    props(text).into_iter().find(|p| p.name == "X-WR-CALNAME").map(|p| unescape(&p.value))
}

/// Occurrences des événements de `text` qui chevauchent [from, to[.
pub fn events_between(text: &str, calendar: usize, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<Event> {
    let mut raws: Vec<Raw> = Vec::new();
    let mut cur: Option<Raw> = None;
    let mut depth = 0; // ignore les sous-composants (VALARM…)
    for p in props(text) {
        match (p.name.as_str(), p.value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => {
                cur = Some(Raw::default());
                depth = 0;
                continue;
            }
            ("END", "VEVENT") => {
                if let Some(r) = cur.take() {
                    raws.push(r);
                }
                continue;
            }
            ("BEGIN", _) if cur.is_some() => {
                depth += 1;
                continue;
            }
            ("END", _) if cur.is_some() => {
                depth -= 1;
                continue;
            }
            _ => {}
        }
        let Some(r) = cur.as_mut() else { continue };
        if depth > 0 {
            continue;
        }
        match p.name.as_str() {
            "UID" => r.uid = p.value.clone(),
            "SUMMARY" => r.title = unescape(&p.value),
            "LOCATION" => r.location = unescape(&p.value),
            "DTSTART" => r.start = parse_dt(&p),
            "DTEND" => r.end = parse_dt(&p),
            "DURATION" => r.duration = parse_duration(&p.value),
            "RRULE" => r.rrule = Some(p.value.clone()),
            "EXDATE" => {
                for v in p.value.split(',') {
                    let q = Prop { name: p.name.clone(), params: p.params.clone(), value: v.to_string() };
                    if let Some((d, _)) = parse_dt(&q) {
                        r.exdates.push(d);
                    }
                }
            }
            "RECURRENCE-ID" => r.recurrence_id = parse_dt(&p).map(|x| x.0),
            "STATUS" => r.cancelled = p.value.eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }

    // Occurrences modifiées individuellement : (UID, instant d'origine).
    let overridden: HashSet<(String, i64)> = raws
        .iter()
        .filter_map(|r| r.recurrence_id.map(|d| (r.uid.clone(), d.timestamp())))
        .collect();

    let (from_ms, to_ms) = (from.timestamp_millis(), to.timestamp_millis());
    let mut out = Vec::new();
    for r in &raws {
        let Some((start, all_day)) = r.start else { continue };
        if r.cancelled {
            continue;
        }
        let len = match (r.end, r.duration) {
            (Some((e, _)), _) => e - start,
            (None, Some(d)) => d,
            (None, None) if all_day => Duration::days(1),
            _ => Duration::zero(),
        };
        let mut push = |s: DateTime<Tz>| {
            let (a, b) = (s.timestamp_millis(), (s + len).timestamp_millis());
            if b.max(a + 1) > from_ms && a < to_ms {
                out.push(Event { title: r.title.clone(), start: a, end: b, all_day, location: r.location.clone(), calendar });
            }
        };
        match (&r.rrule, r.recurrence_id) {
            (Some(rule), None) => {
                for s in expand(rule, start, &r.exdates, from - len.max(Duration::zero()), to) {
                    if !overridden.contains(&(r.uid.clone(), s.timestamp())) {
                        push(s);
                    }
                }
            }
            _ => push(start),
        }
    }
    out.sort_by_key(|e| (e.start, !e.all_day));
    out
}

fn expand(rule: &str, start: DateTime<Tz>, exdates: &[DateTime<Tz>], from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<DateTime<Tz>> {
    let build = |rule: &str| -> Option<RRuleSet> {
        let rr: RRule<Unvalidated> = rule.parse().ok()?;
        let rr = rr.validate(start).ok()?;
        let mut set = RRuleSet::new(start).rrule(rr);
        for d in exdates {
            set = set.exdate(*d);
        }
        Some(set)
    };
    // UNTIL au format date seule, ou sans « Z » alors que DTSTART a un fuseau : on le normalise.
    let set = build(rule).or_else(|| {
        let fixed: Vec<String> = rule
            .split(';')
            .map(|kv| match kv.split_once('=') {
                Some((k, v)) if k.eq_ignore_ascii_case("UNTIL") => {
                    let v = if v.len() == 8 { format!("{v}T235959") } else { v.trim_end_matches('Z').to_string() };
                    match NaiveDateTime::parse_from_str(&v, "%Y%m%dT%H%M%S").ok().and_then(|n| resolve(&start.timezone(), n)) {
                        Some(d) => format!("UNTIL={}", d.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ")),
                        None => kv.to_string(),
                    }
                }
                _ => kv.to_string(),
            })
            .collect();
        build(&fixed.join(";"))
    });
    let Some(set) = set else { return vec![start] };
    let tz = start.timezone();
    let set = set.after(from.with_timezone(&tz)).before(to.with_timezone(&tz));
    set.all(1000).dates
}

#[cfg(test)]
mod tests {
    use super::*;

    const ICS: &str = "BEGIN:VCALENDAR\r
X-WR-CALNAME:Perso\r
BEGIN:VEVENT\r
UID:a\r
SUMMARY:Réunion\\, équipe\r
DTSTART;TZID=Europe/Paris:20261005T100000\r
DTEND;TZID=Europe/Paris:20261005T110000\r
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\r
EXDATE;TZID=Europe/Paris:20261012T100000\r
LOCATION:Salle\r
 B\r
BEGIN:VALARM\r
DTSTART:19700101T000000\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:a\r
RECURRENCE-ID;TZID=Europe/Paris:20261019T100000\r
SUMMARY:Réunion déplacée\r
DTSTART;TZID=Europe/Paris:20261020T140000\r
DTEND;TZID=Europe/Paris:20261020T150000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:b\r
SUMMARY:Anniversaire\r
DTSTART;VALUE=DATE:20261007\r
DTEND;VALUE=DATE:20261008\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:c\r
SUMMARY:Outlook\r
DTSTART;TZID=Romance Standard Time:20261006T090000\r
DURATION:PT30M\r
END:VEVENT\r
END:VCALENDAR\r
";

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn parse_and_expand() {
        assert_eq!(calendar_name(ICS).as_deref(), Some("Perso"));
        let ev = events_between(ICS, 0, utc("2026-10-01T00:00:00Z"), utc("2026-11-01T00:00:00Z"));
        let titles: Vec<_> = ev.iter().map(|e| e.title.as_str()).collect();
        // 5 oct, 6 oct (Outlook), 7 oct (journée), 20 oct (déplacée), 26 oct ; 12 exclu, 19 remplacé
        assert_eq!(titles, ["Réunion, équipe", "Outlook", "Anniversaire", "Réunion déplacée", "Réunion, équipe"], "{ev:#?}");
        assert_eq!(ev[0].start, utc("2026-10-05T08:00:00Z").timestamp_millis());
        assert_eq!(ev[0].end - ev[0].start, 3_600_000);
        assert_eq!(ev[0].location, "SalleB");
        assert_eq!(ev[1].start, utc("2026-10-06T07:00:00Z").timestamp_millis());
        assert_eq!(ev[1].end - ev[1].start, 1_800_000);
        assert!(ev[2].all_day);
        // 26 oct : heure d'hiver (UTC+1)
        assert_eq!(ev[4].start, utc("2026-10-26T09:00:00Z").timestamp_millis());
    }

    #[test]
    fn until_date_only() {
        let ics = "BEGIN:VEVENT\nUID:x\nSUMMARY:Daily\nDTSTART;TZID=Europe/Paris:20261001T080000\nRRULE:FREQ=DAILY;UNTIL=20261003\nEND:VEVENT\n";
        let ev = events_between(ics, 0, utc("2026-09-01T00:00:00Z"), utc("2026-12-01T00:00:00Z"));
        assert_eq!(ev.len(), 3);
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(Duration::minutes(90)));
        assert_eq!(parse_duration("P1D"), Some(Duration::days(1)));
        assert_eq!(parse_duration("P1W"), Some(Duration::weeks(1)));
    }
}
