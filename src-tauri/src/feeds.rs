//! Récupération et analyse des flux RSS / Atom / JSON Feed.
//! Fait côté Rust pour contourner les restrictions CORS de la WebView.

use futures::future::join_all;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Clone)]
pub struct FeedItem {
    pub title: String,
    pub link: String,
    /// millisecondes depuis l'époque Unix (0 si inconnue)
    pub date: i64,
    pub summary: String,
    pub image: Option<String>,
    pub source: String,
}

#[derive(Serialize)]
pub struct FeedResult {
    pub items: Vec<FeedItem>,
    pub errors: Vec<String>,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("DynamicBackground/0.1 (+https://github.com/mathgen44)")
        .timeout(Duration::from_secs(20))
        .build()
        .expect("client HTTP")
}

/// Retire les balises HTML et décode les entités les plus courantes.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&rsquo;", "’")
        .replace("&hellip;", "…");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Cherche la première image `<img src="...">` dans un fragment HTML.
fn first_img(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let i = lower.find("<img")?;
    let rest = &html[i..];
    let s = rest.to_ascii_lowercase().find("src=")? + 4;
    let quote = rest[s..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let end = rest[s + 1..].find(quote)?;
    let url = &rest[s + 1..s + 1 + end];
    url.starts_with("http").then(|| url.to_string())
}

async fn fetch_one(client: &reqwest::Client, url: &str) -> Result<Vec<FeedItem>, String> {
    let bytes = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("{url} : {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("{url} : {e}"))?;
    parse(&bytes, url)
}

/// Analyse le contenu d'un flux (RSS 0.x/1.0/2.0, Atom, JSON Feed).
pub fn parse(bytes: &[u8], url: &str) -> Result<Vec<FeedItem>, String> {
    let feed = feed_rs::parser::parse(bytes).map_err(|e| format!("{url} : {e}"))?;
    let source = feed
        .title
        .as_ref()
        .map(|t| strip_html(&t.content))
        .unwrap_or_else(|| url.to_string());

    Ok(feed
        .entries
        .into_iter()
        .map(|e| {
            let content_html = e
                .content
                .as_ref()
                .and_then(|c| c.body.clone())
                .unwrap_or_default();
            let summary_html = e.summary.as_ref().map(|s| s.content.clone()).unwrap_or_default();
            let image = e
                .media
                .iter()
                .flat_map(|m| {
                    m.thumbnails
                        .iter()
                        .map(|t| t.image.uri.clone())
                        .chain(m.content.iter().filter_map(|c| {
                            let is_img = c
                                .content_type
                                .as_ref()
                                .map(|t| t.ty() == "image")
                                .unwrap_or(false);
                            is_img.then(|| c.url.as_ref().map(|u| u.to_string())).flatten()
                        }))
                        .collect::<Vec<_>>()
                })
                .next()
                .or_else(|| {
                    e.links
                        .iter()
                        .find(|l| l.media_type.as_deref().unwrap_or("").starts_with("image"))
                        .map(|l| l.href.clone())
                })
                .or_else(|| first_img(&summary_html))
                .or_else(|| first_img(&content_html));
            let mut summary = strip_html(if summary_html.is_empty() { &content_html } else { &summary_html });
            if summary.chars().count() > 280 {
                summary = summary.chars().take(277).collect::<String>() + "…";
            }
            FeedItem {
                title: e.title.map(|t| strip_html(&t.content)).unwrap_or_default(),
                link: e.links.first().map(|l| l.href.clone()).unwrap_or_default(),
                date: e.published.or(e.updated).map(|d| d.timestamp_millis()).unwrap_or(0),
                summary,
                image,
                source: source.clone(),
            }
        })
        .collect())
}

pub async fn fetch_all(client: &reqwest::Client, urls: Vec<String>, limit: usize) -> FeedResult {
    let urls: Vec<String> = urls
        .into_iter()
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .collect();
    let results = join_all(urls.iter().map(|u| fetch_one(client, u))).await;
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for r in results {
        match r {
            Ok(mut v) => items.append(&mut v),
            Err(e) => errors.push(e),
        }
    }
    items.sort_by_key(|i| std::cmp::Reverse(i.date));
    items.truncate(limit.max(1));
    FeedResult { items, errors }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rss2_with_enclosure_and_html() {
        let xml = r#"<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Démo &amp; Co</title>
        <item><title>Premier &lt;b&gt;article&lt;/b&gt;</title><link>https://ex.org/1</link><pubDate>Fri, 02 Oct 2026 08:00:00 GMT</pubDate>
        <description>&lt;p&gt;Bonjour &lt;img src="https://ex.org/a.jpg"/&gt; le monde&lt;/p&gt;</description></item>
        <item><title>Second</title><link>https://ex.org/2</link><pubDate>Fri, 02 Oct 2026 09:00:00 GMT</pubDate>
        <media:thumbnail url="https://ex.org/t.jpg"/></item></channel></rss>"#;
        let items = parse(xml.as_bytes(), "u").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source, "Démo & Co");
        assert_eq!(items[0].title, "Premier article");
        assert_eq!(items[0].summary, "Bonjour le monde");
        assert_eq!(items[0].image.as_deref(), Some("https://ex.org/a.jpg"));
        assert_eq!(items[1].image.as_deref(), Some("https://ex.org/t.jpg"));
        assert!(items[1].date > items[0].date);
    }

    #[test]
    fn atom() {
        let xml = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
        <entry><title>Entrée</title><link href="https://ex.org/e"/><updated>2026-10-01T10:00:00Z</updated><summary>Résumé</summary></entry></feed>"#;
        let items = parse(xml.as_bytes(), "u").unwrap();
        assert_eq!(items[0].link, "https://ex.org/e");
        assert_eq!(items[0].summary, "Résumé");
        assert!(items[0].date > 0);
    }

    #[test]
    fn invalid() {
        assert!(parse(b"<html>pas un flux</html>", "u").is_err());
    }
}
