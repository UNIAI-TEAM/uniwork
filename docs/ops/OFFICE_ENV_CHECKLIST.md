# Checklist: Office per-environment setup

> **Trạng thái:** in-progress (UNI-954). Linked from [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md).

Everything the Helm chart and the repo cannot decide for an environment, in one list. Tick each line
per environment (staging, production) before turning `officeEngine.enabled` on or publishing an
installer. Nothing here is a secret value; secrets are created out of band and referenced by name.

## 1. Engine pod (`officeEngine.enabled=true`)

| # | Item | Where | Done |
| --- | --- | --- | --- |
| 1 | Secret `uniwork-office-engine` exists with keys `OFFICE_ENGINE_SERVICE_TOKEN` and `OFFICE_ENGINE_GRANT_KEY`, each >= 32 chars and different from each other. Command: `deploy/app/env/README.md` "Office engine". Without it the engine pod fails at start and so does the BE (its refs are required once the switch is on) | namespace `uniwork` | [ ] |
| 2 | `OFFICE_ENGINE_URL` is **empty** in `deploy/app/env/uniwork-be.env` (the chart sets it) | repo | [ ] |
| 3 | `officeEngine.outputOrigins`: the bare origin(s) of the file store's presigned URLs (`https://host[:port]`, comma separated, no trailing slash). Empty means every output write is refused (`output_write_*`). Rollout script: `OFFICE_ENGINE_OUTPUT_ORIGINS` | values / env | [ ] |
| 4 | `networkPolicy.officeEngineFileStore`: the file store's IP CIDR(s) as `{cidr: "x.x.x.x/32", port: 443}`. A NetworkPolicy cannot match DNS names, so resolve the store and list every address. Empty leaves the engine with DNS only and every output write fails | values file | [ ] |
| 5 | Engine image built from the repo root (`docker build -f apps/office-engine/Dockerfile ...`), pushed, digest recorded. The chart requires a digest | registry | [ ] |
| 6 | Kubelet `podPidsLimit: 256` on every node that can schedule the engine (a pod spec has no per-pod pids field; compose uses `pids_limit: 256`). Node-level `KubeletConfiguration`, ops action; check with `kubectl get --raw /api/v1/nodes/<node>/proxy/configz` | node pool | [ ] |
| 7 | The CNI enforces NetworkPolicy (otherwise the engine's ingress and egress restrictions do nothing) | cluster | [ ] |
| 8 | Rollout through `ci/scripts/rollout-uniwork.sh` with `OFFICE_ENGINE_ENABLED=1`, `OFFICE_ENGINE_DIGEST`, `OFFICE_ENGINE_OUTPUT_ORIGINS` and, for the CIDRs, `OFFICE_ENGINE_VALUES_FILE`. Every later rollout must pass the same, or the engine is removed | CI | [ ] |

Example values file for `OFFICE_ENGINE_VALUES_FILE`:

```yaml
networkPolicy:
  officeEngineFileStore:
    - { cidr: "203.0.113.10/32", port: 443 }
officeEngine:
  resources:
    limits: { cpu: "2", memory: 2Gi }
```

Kubelet snippet (item 6):

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
podPidsLimit: 256
```

After the rollout: `kubectl -n uniwork get pods -l app.kubernetes.io/name=uniwork-office-engine` is `1/1 Running`,
the init container `tmp-sticky` completed, and the BE logs no engine error. Switch the flags on only after that
(`office_engine`, then the format flags: [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md) "Per-format flags").

## 2. Installer download URLs

The server reads `OFFICE_INSTALLER_<CHANNEL>_URLS` ([`desktop-packaging.md`](../office/g3g4/desktop-packaging.md)).

| # | Item | Done |
| --- | --- | --- |
| 1 | Every URL is public HTTPS with no credentials, query or fragment, and the server can fetch it **without credentials**. A private repository's release assets are not fetchable: mirror them | [ ] |
| 2 | The host answers **200 directly**. The `bundle=true` download refuses redirects, and a GitHub release asset URL (`github.com/<org>/<repo>/releases/download/...`) redirects (302) to its storage host, so it does not work for the bundle route even on a public repository. Mirror to a host that serves the file itself | [ ] |
| 3 | Mirror and regenerate the value: `node scripts/office/installer-urls.mjs --channel <dev\|beta> --base-url https://downloads.example/office/<channel> --dir <folder with the installers>` | [ ] |
| 4 | Set the value in the server's config and restart; check `GET /api/v1/config`: `office_installers.<channel>` lists the expected `platform`, `url`, `version`, `unsigned: true` | [ ] |
| 5 | `OFFICE_INSTALLER_STABLE_URLS` stays empty (signing is parked) | [ ] |

## 3. Bucket CORS (only if browsers call the bucket directly)

Background and evidence: [`bucket-cors.md`](../office/g3g4/bucket-cors.md). Web upload and download go through
the API today, so this is a safeguard for presigned URLs read or written from the browser.

| # | Item | Done |
| --- | --- | --- |
| 1 | Real S3 / the production object store: apply `deploy/app/storage-cors.example.json` with the production origins (`FRONTEND_ORIGIN`, `PREVIEW_ORIGIN`; exact scheme + host + port, no `*`) and verify with a preflight `OPTIONS` from each origin. Only MinIO `bitnamilegacy/minio` 2025.7.23 was exercised in this repo | [ ] |
| 2 | MinIO: per-bucket CORS is not implemented there; set the global `MINIO_API_CORS_ALLOW_ORIGIN` to the same origins and recreate the container. Re-check after a MinIO upgrade: newer releases were not exercised | [ ] |
| 3 | Preflight answers `Allow-Origin` equal to the requesting origin, allows `PUT`/`GET`/`HEAD`, `Content-Type`/`Content-MD5`/`Range`, and exposes `ETag` | [ ] |

## 4. First installer build (not run yet)

`.github/workflows/office-desktop-installers.yml` is checked with actionlint only. Its first real run needs:

- a build-only probe first: push the branch `ci/office-desktop-installers-probe` (channel dev, build number = run
  number) or dispatch with `publish` left false. Both build the two legs and keep the artifacts (3 days for the probe
  push) and never create a tag, release or asset;
- the publishing run: a manual dispatch with `publish=true` (inputs `channel` dev|beta, `require_xlsx_sidecar` true by
  default) or an `office-desktop-v<package version>-<dev|beta>.<build>` tag push, run on a branch that carries the file;
- both build legs finishing in under 60 minutes each (Rust sidecar build included; Windows uses `C:\cargo-t` as the
  cargo target dir to stay under MAX_PATH);
- `contents: write` for the default token on the publish job (repository setting: workflow permissions);
- section 2 above for the resulting URLs.

macOS is not built (no Mac runner); signing, notarization and the update feed are parked until certificates exist.
