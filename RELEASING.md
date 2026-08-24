# Releasing the Windows app

GitHub Actions builds and publishes the Windows installer whenever a `v*` tag is pushed.

1. Update the app version and commit the change.
2. Create an annotated tag matching `package.json` exactly.
3. Push the commit and tag.

```bash
npm version patch
git push origin main --follow-tags
```

The workflow verifies that the tag matches `package.json`, builds with Node.js 24 on
`windows-latest`, and always attaches a portable Windows ZIP to a GitHub Release. It also attempts
to attach the installer, blockmap, and `latest.yml`; an installer failure does not block the
portable release. The API server remains a separate
systemd deployment and is not changed by this workflow.
