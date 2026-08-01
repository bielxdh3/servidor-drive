# Backup Archive Security Validation

Root.ark validates every ZIP entry before restore extraction. Validation rejects checksum mismatches, traversal and absolute paths, disallowed top-level roots, sensitive runtime entries, Unix symlink metadata, missing or invalid manifests, duplicate manifests, and normalized or case-insensitive destination collisions.

Unix symlinks are detected from either the Unzipper entry type or Unix central-directory mode bits. This covers entries that Unzipper exposes as `File`, including the regression fixture with `versionMadeBy=0x0314` and external attributes `0xA1FF0000`.

Extraction resolves each destination canonically and uses `path.relative()` containment. Rejected disposable fixtures leave extraction output, restore temp, runtime JSON, uploads, backup history, outside sentinels, and the module checkout unchanged.

Cloud backup behavior, scheduler/retention pressure, and full production SQLite recovery remain outside this validation.
