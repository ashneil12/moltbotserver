# OpenClaw Local Customizations

This document tracks customizations made to this fork compared to upstream `openclaw/openclaw`.

> [!IMPORTANT]
> Reference this file when updating from upstream to ensure these changes are preserved.

---

## Security Hardening

### Removed Features
- **SoulEvil persona**: Removed for safety/security reasons

### Modified Files
<!-- Add files you've modified for security here -->
- `docker-entrypoint.sh` - Custom security configurations
- `Dockerfile` - Hardened container setup

### Added Security Measures
<!-- Document any security additions -->
- TBD - Add your security measures here

---

## Critical Files (Do Not Overwrite)

Files that should always keep local version during updates:

| File | Reason |
|------|--------|
| `docker-compose.coolify.yml` | Coolify deployment configuration |
| `docker-entrypoint.sh` | Custom initialization logic |
| `.env.example` | Local environment template |

---

## Safe to Update

Files that can generally take upstream version:

- `README.md`
- `CHANGELOG.md`
- Documentation in `docs/`
- Dependencies in `package.json` (review carefully)

---

## Update History

| Date | Upstream Commit | Notes |
|------|-----------------|-------|
| TBD  | TBD | Initial fork |

---

## Notes

Add any other context about your customizations here that would help during updates.
