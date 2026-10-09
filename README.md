# Icebreaker Map

A host shows a QR code. Participants scan it on their phones, enter a name and a short
answer to the host's question, and appear on a shared live map.

## How it works

- **Host** (`/`): pick a suggested icebreaker question (or write your own) and start a session, then show `host.html`: a QR code, the join link, a live map and a list of who has joined.
- **Participant** (`join.html?s=<id>`): enter a name, an answer and a US ZIP code, then see everyone on the map. No device-location permission is needed.
- **Live updates** use Server-Sent Events, so the host map updates as people join or leave.
- **Map**: [Leaflet](https://leafletjs.com) with OpenStreetMap tiles (no API key). Each person is a colored initial pin; new joiners pop in with a pulse.

## Privacy

- The server looks up the ZIP code (via [Zippopotam.us](https://api.zippopotam.us), no API key) and **rounds the result to 1 decimal degree (about 11 km, city level)**. The ZIP itself is never stored, and exact coordinates are never sent to other participants.
- Participants see a consent note on the join page and can remove their own pin at any time.
- Data lives in memory only. It is deleted when the host ends the session, after `SESSION_TTL_HOURS` (default 12), or when the server restarts.

## Run it

```sh
npm install
npm start          # http://localhost:3000
npm test
```

The QR code must point at an address phones can reach. For real use:

- Deploy anywhere that runs Node (Render, Fly.io, Railway, ...) and set `PUBLIC_URL` to the public URL, or
- Test locally through a tunnel, for example `cloudflared tunnel --url http://localhost:3000`, then run with `PUBLIC_URL=https://<tunnel-host> npm start`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_URL` | derived from the request | Base URL encoded in the QR code |
| `SESSION_TTL_HOURS` | `12` | How long a session (and its data) is kept |

## Limits

Up to 300 participants per session; names are capped at 40 characters and answers at
140. Session creation and joining are rate limited per IP. Only US ZIP codes are supported. Sessions are held in one
process's memory, so run a single instance.
