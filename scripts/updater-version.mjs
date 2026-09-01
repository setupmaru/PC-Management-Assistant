const version = process.argv[2]
if (!version) {
  console.error('Usage: node scripts/updater-version.mjs <version>')
  process.exit(1)
}

const revisionVersion = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(version)
if (!revisionVersion) {
  console.log(version)
  process.exit(0)
}

const [, major, minor, patch, revision] = revisionVersion
console.log(`${major}.${minor}.${Number(patch) + 1}-revision.${revision}`)
