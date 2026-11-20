# DiviDinDin!

A mobile-first web app for sharing expenses among friends. Create an event, add participants, record expenses and payments, and see how balances can be settled. [Visit DiviDinDin!](https://dividindin.com/)

## About this repository

This repository is a **presentation snapshot** of the project as it stood in November 2026. It is not the live development repository and is not updated continuously. It may be refreshed from time to time, but regular updates are not a priority. The live application may differ from this code.

The snapshot omits private operational documents, deployment scripts, historical records and real user data. The original photographic backgrounds have been replaced with neutral placeholders; the published application uses photographs by Felipe. Session configuration has also been adjusted for this presentation: a new development secret is generated at each server start, and production requires an explicitly configured secret.

## The project

DiviDinDin! began as a tool for friends: a free way to split shared expenses without a subscription. Its optional donation model is designed around transparency about operating costs. The interface takes inspiration from night photographs shot with flash: dark surroundings, bright details and sharp contrast. The production service uses a React frontend, a Node.js backend and SQLite, with the backend hosted on a repurposed Samsung Galaxy S10e.

Features include participant invitations and claiming, flexible expense splits, recorded payments, suggested settlements, real-time updates, installable web app support and a sustainability screen.

## Creating with AI agents

Felipe Yamahata directs the project through vibe coding. He developed the product concept, visual direction and a workflow that guides AI agents with focused instructions, repository structure, tests and reviews. The private working project also uses an index, project memory, an append-only history and a structured Git workflow. Those operational records are not included in this presentation snapshot.

## Explore the code

- `src/client/` — React interface and interaction design.
- `src/domain/` — isolated calculations and other domain logic, including settlement and expense shares.
- `src/db/` and `src/routes/` — SQLite persistence and HTTP endpoints.
- `tests/` — unit and integration checks.

## Run locally

Requires Node.js 24 or later and npm. This snapshot is for local exploration and has not been prepared as a production deployment guide.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:3001/divide/`. Data is stored in the ignored `data/` directory. The local session secret changes on each restart, so existing sessions will be invalidated. Optional integrations, such as Google sign-in and dynamic Pix, require separate configuration and are not necessary for exploring the core app. Never use real user data or payment credentials for local experimentation.

Run the verification suite with `npm test`.

## Usage and licensing

The source is made available for viewing as a portfolio presentation. No open-source license is granted by this snapshot. Third-party dependencies and bundled fonts retain their respective licenses. Contact Felipe for permission before using or redistributing the project outside rights provided by GitHub's terms.
