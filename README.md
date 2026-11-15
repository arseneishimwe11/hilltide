# Hilltide

Rwanda's thousand hills, alive.

A cinematic, real-time 3D web experience of Rwanda and Kigali, computed live in
the browser from open data: the land, the city growing from 2016 to 2023, and
where rain flows across the hills.

The project is being built in phases. Current state and next steps are in
[docs/STATUS.md](docs/STATUS.md). The full brief is in
[docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md).

## Layout

| Path | What it holds |
|---|---|
| `web/` | The site: Vite and TypeScript |
| `pipeline/` | Python data pipeline that builds the web assets from open data |
| `scripts/` | Repository checks |
| `docs/` | Brief, status, decisions, licenses |
| `site.config.json` | Creator name and links shown on the site |

## Run it

Needs Node 22, Python 3.13 and [uv](https://docs.astral.sh/uv/).

```bash
make setup
```

```bash
make dev
```

```bash
make check
```

```bash
make e2e
```

`make e2e` builds the site, runs the headless browser tests and saves
screenshots to `web/test-results/screens/`.

## Honest limits

Hilltide is a visualization. Its rain simulation shows where water flows over
the terrain; it does not forecast floods and is not a warning system.

## License

The license for Hilltide's own code is the owner's decision and has not been
chosen yet (see "Needs owner" in [docs/STATUS.md](docs/STATUS.md)). Data, fonts
and dependencies keep their own licenses, listed in
[docs/LICENSES.md](docs/LICENSES.md).
