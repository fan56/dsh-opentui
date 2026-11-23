# N1 raw frame dumps — sha registry

These four raw host-stdout frame dumps were removed from the repo on 2026-11-23 because they tripped the `secret-value-field` pattern of `scripts/scan-stdio-secrets.mjs` (855 hits: schema-describe `value` fields, 14 of 52 distinct values are public defaults already present in `capir/capir.json`; zero credential-shaped matches). Per the credential discipline (values never land in the repo) they are replaced by this sha registry. Regenerate with `.proof/batch-gate/n1-probe.mjs` against a scratch home.

| file | sha256 |
|---|---|
| `.proof/batch-gate/step6-n1/n1-host-1.stdout.frames` | `01825a75ed9373ba935c82b1ddce27e6f7b1a39623008dcdaca0c7725de486a6` |
| `.proof/batch-gate/step6-n1/n1-host-2.stdout.frames` | `c0abe07bdf0a77d6e8a8fb42c62c82a97c375dc57880de210a0a74aedc420b20` |
| `.proof/batch-gate/step6-n1-corrected/n1-host-1.stdout.frames` | `6143f78c18e8a3c057bf294fc0c3f4814050a93a19106fd4f73383df53e74073` |
| `.proof/batch-gate/step6-n1-corrected/n1-host-2.stdout.frames` | `99047ae9fd77735dd5b392fd7d959f81b337572776a0812d6a3d41e6537fac60` |
