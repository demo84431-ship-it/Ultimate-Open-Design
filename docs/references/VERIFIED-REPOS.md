# Verified Repository References

**Verified:** 2026-05-09 via GitHub API (`/repos/:owner/:repo` endpoint)

## Tier 1: Much Larger Than open-design (34k)

| Repo | Verified Stars | URL | Purpose |
|------|---------------|-----|---------|
| anomalyco/opencode | 157,179 | https://github.com/anomalyco/opencode | Open-source coding agent |
| shadcn-ui/ui | 113,861 | https://github.com/shadcn-ui/ui | Accessible UI components |
| Comfy-Org/ComfyUI | 112,028 | https://github.com/Comfy-Org/ComfyUI | Local AI image/video generation |
| tailwindlabs/tailwindcss | 94,892 | https://github.com/tailwindlabs/tailwindcss | CSS framework |
| storybookjs/storybook | 89,871 | https://github.com/storybookjs/storybook | Component workshop |
| lobehub/lobehub | 76,597 | https://github.com/lobehub/lobehub | AI platform |
| cline/cline | 61,534 | https://github.com/cline/cline | IDE coding agent |
| penpot/penpot | 47,422 | https://github.com/penpot/penpot | Open-source design tool |
| Aider-AI/aider | 44,547 | https://github.com/Aider-AI/aider | Terminal AI pair programming |
| GoogleChrome/lighthouse | 30,168 | https://github.com/GoogleChrome/lighthouse | Web auditing |
| vercel/ai | 24,106 | https://github.com/vercel/ai | AI SDK |

## Tier 2: Smaller But Relevant

| Repo | Verified Stars | URL | Purpose |
|------|---------------|-----|---------|
| stackblitz-labs/bolt.diy | 19,335 | https://github.com/stackblitz-labs/bolt.diy | AI app builder |
| dequelabs/axe-core | 7,136 | https://github.com/dequelabs/axe-core | Accessibility engine |
| BuilderIO/builder | 8,664 | https://github.com/BuilderIO/builder | Visual development |
| OpenCoworkAI/open-codesign | 5,312 | https://github.com/OpenCoworkAI/open-codesign | Claude Design alternative |

## How to Verify

```bash
curl -s "https://api.github.com/repos/{owner}/{repo}" | grep '"stargazers_count"'
```

Note: Some repos redirect (lobehub, ComfyUI). Use `-L` flag with curl to follow redirects.
