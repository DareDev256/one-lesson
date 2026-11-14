# One Lesson

**Teach one robot. Every robot learns. Undo it in one click.**

One Lesson is a governed skill memory for a fleet of home robots, built on MongoDB Atlas. You teach one robot a household skill, by voice or by tapping. The lesson reaches every home in the fleet live. Each home's own rules decide whether it may take it. Every lesson carries its teacher, a version and a family tree. That means any lesson can be traced, and rolled back across every home at once.

Track: **Memory You Can Govern**. Built at *Agents in Context Toronto* (MongoDB hackathon), 14 November 2026.

![Bad lesson: four homes took it (red), the two kids' homes refused it at their shields](docs/screenshots/2026-11-14_beats-4-bad-settled.png)

## The demo: one sentence, asked four times

1. **Before.** Ask Home 2 "put the dishes away". It answers out loud: "I don't know how to do that yet."
2. **Teach.** James teaches "load the dishwasher" in Home 1. All six homes learn it, each in its own kitchen. Ask Home 2 again and it does it.
3. **The bad lesson.** Alex teaches "kitchen tidy" v2, which puts the knife in the low drawer. Homes 1 to 4 take it. Homes 5 and 6 have kids, and their rules refuse it at the shield. Ask "tidy the kitchen": Home 2 puts the knife LOW, Home 5 puts it HIGH. Same words, different homes, different answers.
4. **Trace and undo.** The lineage shows v1 (James) → v2 (Alex) → "evening reset" (built on v2), and which homes ran or refused each one. Only James can roll back; Alex gets a 403. One click and every home is back on v1. Ask Home 2 again: the knife goes high.
5. **Pull the plug.** Kill the server. Another server writes a lesson while ours is down. Restart. Every home resumes its change stream from its saved resume token and catches up. The board reads "memory in sync 6/6, 0 lessons missing".
6. **Forget me.** A teacher asks to be forgotten. Everything they taught leaves every home, with a receipt.

## What MongoDB Atlas does here

| Feature | What it does in One Lesson | Where |
|---|---|---|
| **Change streams + resume tokens** | Each of the six homes is a worker with its own change stream on `lessons`, filtered by a `$match` to inserts and status changes. It saves its resume token after every event, so a restart or an offline home misses nothing. | `server/fleet.ts` `startWorker` |
| **Automated Embedding (Voyage voyage-4)** | Atlas builds the vectors from each lesson's text. We never call an embedding model ourselves. | `scripts/setup.ts` (`autoEmbed` index) |
| **Vector Search with pre-filters** | Ask finds the closest lesson by meaning, pre-filtered on status. The home's own rules then drop what it may not use. | `server/fleet.ts` `ask` |
| **Native reranking (`$rerank`, Voyage rerank-3)** | Reorders the vector candidates. Measured on our lessons: "put the dishes away" scores 0.639 on "load the dishwasher" against 0.435 before it exists, so the match floor (0.60) cleanly separates "I know this" from "I don't". | `server/fleet.ts` `ask`, `scripts/probe-rerank.ts` |
| **`$graphLookup`** | Walks a lesson up to its root and down through everything built on it, for lineage and for rollback. | `server/fleet.ts` `lineage`, `rollback` |
| **Multi-document transactions** | Rollback and forget mark every affected lesson and write the receipt in one transaction. | `server/fleet.ts` `rollback`, `forgetTeacher` |
| **TTL index (partial)** | Trial lessons expire after 24 hours unless three real requests prove them. | `scripts/setup.ts` `trial_ttl` |
| **Schema validation** | `$jsonSchema` on lessons, homes and events keeps the memory in a valid shape. | `scripts/setup.ts` |

Everything runs on the event's MongoDB Atlas Sandbox (M10, AWS us-west-1, MongoDB 9.0).

## What ElevenLabs does here

- **Teach by talking.** Hold the mic and say "Kitchen tidy. Put the knife and the scissors in the bottom drawer." ElevenLabs **Scribe** (`scribe_v2`) transcribes it. A deterministic parser turns the transcript into steps, so the safety tags never come from a model. (`server/voice.ts` `hear`, `server/domain.ts` `parseSpokenLesson`)
- **Ask by talking.** Hold V and ask any home a question.
- **Every robot has its own voice.** Six homes, six ElevenLabs voices (`eleven_flash_v2_5`). They say what they learned, what they refused and why, and when they rolled back. Lines are cached on disk, so the stage plays from cache. (`server/voice.ts` `say`)

## Safety is deterministic

Tags come from object types, never from a model. Knives and scissors are `sharp`; the low drawer and floor bin are `child-reach`. A sharp item placed at a child-reach target adds `sharp+child-reach`. The kids' homes block `sharp+child-reach` and `chemical`. The console queries a live invariant every second: **0 blocked lessons active in kids' homes**.

## Run it

```bash
npm install
cp .env.example .env        # MONGODB_URI (Atlas, MongoDB 9.0+, native reranking on), ELEVENLABS_API_KEY
npm run setup && npm run demo:reset && npm run build && npm start
```

Open http://localhost:8787 for the presenter console and `/teach` for the phone page.

- `npm test`: 10 unit tests (tag rules, refusals, spoken-lesson parser)
- `npm run smoke`: 15 checks over the demo beats against a running server (run after `demo:reset`)
- `npm run voice:warm`: pre-generates every line the robots say in the demo

Presenter keys: **V** hold to talk · **T** teach · **L** lineage · right-click a face for its kitchen and to take it offline.

## Measured today

Each figure was measured on 14 November 2026 against the sandbox cluster, from Toronto to us-west-1.

- Publish to the last home hearing it: 253 to 863 ms across six homes, computed from `events` timestamps.
- Rollback across four homes: 602 to 1,341 ms.
- Pull the plug: 6 of 6 homes caught up from resume tokens, 0 lessons missing.
- Auto-embedding lag: a new lesson was searchable 1.9 s after insert. Ask waits out that window.

## Honest limits

- The fleet is simulated. One Lesson governs which skills a fleet shares, not how motors move. Any robot that can run a step list could plug in.
- Six homes, one laptop server. We measured six homes and claim nothing beyond that.
- Speech goes to ElevenLabs and lesson text goes to Voyage through Atlas. Nothing else leaves the laptop.

## How it was built (disclosure)

All code in this repository was written on 14 November 2026 at the event, starting with the first commit at 10:06 AM during the kickoff (the official "hacking begins" slot was 10:45 AM). The git history is the record. No code, UI or data from before the event. The six homes, their kitchens and the seed lesson are generated by `scripts/demo-reset.ts`.

Open-source components used, unmodified, under their licenses: Express (MIT), ws (MIT), MongoDB Node.js driver (Apache-2.0), jose (MIT), dotenv (BSD-2-Clause), React (MIT), Vite (MIT), @vitejs/plugin-react (MIT), @auth0/auth0-spa-js (MIT), @huggingface/transformers (Apache-2.0, offline fallback only: `EMBED_MODE=local` with all-MiniLM-L6-v2), Vitest (MIT), tsx (MIT), TypeScript (Apache-2.0), Playwright (Apache-2.0, screenshots). Fonts from Google Fonts (Archivo, IBM Plex Sans, JetBrains Mono, all under the OFL).

Services: MongoDB Atlas (Automated Embedding and `$rerank` with Voyage AI models), ElevenLabs (Scribe speech-to-text, text-to-speech), Auth0 (optional teacher sign-in).

Built by James Dare with Claude Code.

## License

MIT
