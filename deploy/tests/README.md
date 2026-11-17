# deploy.sh test suite
`sudo bash run-tests.sh` builds two DISPOSABLE stacks (`musictest-mtdev`, `musictest-mtprod`) on an internal-only
network from a restored copy of DEV data at `/mnt/media/.restic/restoretest/phase3/master-dev`, runs 84 assertions
(refusals, backup failure, active import/writes, migration deploy, rollback rules, downgrade guard, failed health,
failed endpoint, interrupts incl. real process-group Ctrl-C/HUP/SIGKILL, lock, promotion gate incl. soak/baseline/
schema-path, migration-then-failure handling, mount/ownership checks, registry requirement, health-watch muting/stuck-lock
alerts, alert delivery), and finally asserts the live DEV/PROD containers
and stack files are unchanged. `sudo bash teardown.sh [--all]` removes everything it created.
Prerequisites: the restored master copy, local test images (`images/*/Dockerfile`, built FROM the pinned PROD image).
