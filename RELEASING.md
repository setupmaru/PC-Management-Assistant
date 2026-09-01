# Releasing the desktop app

GitHub Actions builds and publishes the Windows and macOS packages whenever a `v*` tag is pushed.

1. Update `package.json`'s internal SemVer `version` and public `releaseVersion`, then commit the change.
2. Create an annotated tag matching `releaseVersion` exactly.
3. Push the commit and tag.

```bash
release_version=$(node -p "require('./package.json').releaseVersion")
git tag -a "v$release_version" -m "V$release_version"
git push origin main --follow-tags
```

The workflow verifies that the tag matches `releaseVersion`, builds with Node.js 24 on Windows and
macOS, and publishes the verified packages under the public release version. The internal `version`
must remain valid, monotonically increasing SemVer so electron-updater can compare releases. For a
four-part public revision such as `1.0.14.1`, use the next patch prerelease form such as
`1.0.15-revision.1` internally. The API server remains a separate systemd deployment and is not
changed by this workflow.
