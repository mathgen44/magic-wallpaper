// Calculs astronomiques (soleil, lune) sans réseau.
// Adapté de SunCalc (https://github.com/mourner/suncalc), d'après les formules de
// http://aa.quae.nl/en/reken/zonpositie.html ; position de la lune complétée par les
// principaux termes de Meeus (Astronomical Algorithms) et phases par longitude écliptique.
//
// SunCalc — Copyright (c) 2014, Vladimir Agafonkin. All rights reserved.
// Redistribution and use in source and binary forms, with or without modification, are
// permitted provided that the following conditions are met:
//  1. Redistributions of source code must retain the above copyright notice, this list of
//     conditions and the following disclaimer.
//  2. Redistributions in binary form must reproduce the above copyright notice, this list
//     of conditions and the following disclaimer in the documentation and/or other materials
//     provided with the distribution.
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
// OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
// COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
// EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
// GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
// AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
// NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
// ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const PI = Math.PI;
const { sin, cos, tan, asin, atan2: atan, acos } = Math;
const rad = PI / 180;
const dayMs = 864e5;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquité de l'écliptique

const toJulian = (date) => date.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (date) => toJulian(date) - J2000;

const rightAscension = (l, b) => atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
const declination = (l, b) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
const azimuth = (H, phi, dec) => atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
const altitude = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function astroRefraction(h) {
  if (h < 0) h = 0;
  return 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179));
}

const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
  return M + C + rad * 102.9372 + PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

/** Position du soleil : altitude et azimut en radians. */
export function sunPosition(date, lat, lng) {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  return { azimuth: azimuth(H, phi, c.dec), altitude: altitude(H, phi, c.dec) };
}

const J0 = 0.0009;
const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
const hourAngle = (h, phi, d) => acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));
const getSetJ = (h, lw, phi, dec, n, M, L) => solarTransitJ(approxTransit(hourAngle(h, phi, dec), lw, n), M, L);

const TIMES = [
  [-0.833, "sunrise", "sunset"],
  [-6, "dawn", "dusk"],
  [6, "goldenHourEnd", "goldenHour"],
];

/** Heures du soleil pour le jour de `date` (dates invalides si le phénomène n'a pas lieu). */
export function sunTimes(date, lat, lng) {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const result = { solarNoon: fromJulian(Jnoon) };
  for (const [angle, rise, set] of TIMES) {
    const Jset = getSetJ(angle * rad, lw, phi, dec, n, M, L);
    result[rise] = fromJulian(Jnoon - (Jset - Jnoon));
    result[set] = fromJulian(Jset);
  }
  return result;
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const D = rad * (297.8502 + 12.19074912 * d); // élongation moyenne
  const Ms = solarMeanAnomaly(d);
  // Principaux termes périodiques (Meeus, chap. 47) : précision ~0,3° au lieu de ~2°.
  const l = L + rad * (6.289 * sin(M) + 1.274 * sin(2 * D - M) + 0.658 * sin(2 * D) + 0.214 * sin(2 * M) - 0.186 * sin(Ms) - 0.114 * sin(2 * F));
  const b = rad * (5.128 * sin(F) + 0.281 * sin(M + F) + 0.278 * sin(M - F) + 0.173 * sin(2 * D - F));
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * cos(M), lon: l };
}

export function moonPosition(date, lat, lng) {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h += astroRefraction(h);
  return { azimuth: azimuth(H, phi, c.dec), altitude: h, distance: c.dist };
}

/** fraction éclairée (0–1) et phase (0 = nouvelle lune, 0,25 = premier quartier, 0,5 = pleine, 0,75 = dernier quartier). */
export function moonIllumination(date) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi));
  // Phase d'après l'écart en longitude écliptique (définition officielle des phases).
  const sunLon = eclipticLongitude(solarMeanAnomaly(d));
  const phase = ((((m.lon - sunLon) / (2 * PI)) % 1) + 1) % 1;
  return { fraction: (1 + cos(inc)) / 2, phase };
}

const hoursLater = (date, h) => new Date(date.valueOf() + (h * dayMs) / 24);

/** Lever et coucher de la lune pour le jour local de `date`. */
export function moonTimes(date, lat, lng) {
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  const hc = 0.133 * rad;
  let h0 = moonPosition(t, lat, lng).altitude - hc;
  let rise, set, ye;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonPosition(hoursLater(t, i), lat, lng).altitude - hc;
    const h2 = moonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    const disc = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = 0;
    let x2 = 0;
    if (disc >= 0) {
      const dx = Math.sqrt(disc) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise && set) break;
    h0 = h2;
  }
  const r = {};
  if (rise) r.rise = hoursLater(t, rise);
  if (set) r.set = hoursLater(t, set);
  if (!rise && !set) r[ye > 0 ? "alwaysUp" : "alwaysDown"] = true;
  return r;
}

const SYNODIC = 29.530588853;

/** Prochain instant (après `from`) où la phase vaut `target` (0 = nouvelle lune, 0,5 = pleine lune). */
export function nextPhase(from, target) {
  const dist = (p) => (((p - target) % 1) + 1.5) % 1 - 0.5; // écart signé dans [-0,5 ; 0,5[
  let t = from.valueOf();
  const step = 6 * 3600e3;
  let prev = dist(moonIllumination(new Date(t)).phase);
  for (let i = 0; i < 4 * 32; i++) {
    const t2 = t + step;
    const cur = dist(moonIllumination(new Date(t2)).phase);
    if (prev < 0 && cur >= 0) {
      // affinage par dichotomie
      let a = t;
      let b = t2;
      for (let k = 0; k < 30; k++) {
        const m = (a + b) / 2;
        if (dist(moonIllumination(new Date(m)).phase) < 0) a = m;
        else b = m;
      }
      return new Date(b);
    }
    prev = cur;
    t = t2;
  }
  return null;
}

/** Âge de la lune en jours (depuis la dernière nouvelle lune). */
export const moonAge = (phase) => phase * SYNODIC;

export function phaseName(p) {
  const near = (x, tol = 0.017) => Math.abs(((p - x + 1.5) % 1) - 0.5) < tol;
  if (near(0)) return "Nouvelle lune";
  if (near(0.25)) return "Premier quartier";
  if (near(0.5)) return "Pleine lune";
  if (near(0.75)) return "Dernier quartier";
  if (p < 0.25) return "Premier croissant";
  if (p < 0.5) return "Gibbeuse croissante";
  if (p < 0.75) return "Gibbeuse décroissante";
  return "Dernier croissant";
}

/**
 * Chemin SVG de la partie éclairée d'un disque de rayon r centré en (0,0).
 * southern = vue depuis l'hémisphère sud (image inversée gauche/droite).
 */
export function moonLitPath(phase, r = 1, southern = false) {
  const p = ((phase % 1) + 1) % 1;
  const rx = Math.abs(Math.cos(2 * PI * p)) * r;
  const waxing = p < 0.5;
  let outer = waxing ? 1 : 0; // demi-cercle éclairé : droite (croissante) ou gauche
  let inner;
  if (waxing) inner = p < 0.25 ? 0 : 1;
  else inner = p < 0.75 ? 0 : 1;
  if (southern) {
    outer = 1 - outer;
    inner = 1 - inner;
  }
  return `M0 ${-r}A${r} ${r} 0 0 ${outer} 0 ${r}A${rx.toFixed(4)} ${r} 0 0 ${inner} 0 ${-r}Z`;
}
