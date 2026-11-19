import { assert, test } from 'orca/testing'
import { ECOSYSTEMS } from './categories'
import { createClassifier, detectEcosystems, globToRegExp, parseOverrides } from './classify'

const eco = (...names: string[]) => ECOSYSTEMS.filter((e) => names.includes(e.name))

test('globs: a name pattern matches in any folder, a path pattern is anchored', () => {
  assert.ok(globToRegExp('*.md').test('docs/guide/intro.md'))
  assert.ok(globToRegExp('Cargo.toml').test('crates/domain/Cargo.toml'))
  assert.ok(globToRegExp('.github/workflows/**').test('.github/workflows/ci.yml'))
  assert.ok(!globToRegExp('.github/workflows/**').test('vendor/.github/workflows/ci.yml'))
  assert.ok(globToRegExp('**/migrations/**').test('apps/web/migrations/0001_init.sql'))
  assert.ok(globToRegExp('**/migrations/**').test('migrations/0001_init.sql'))
  assert.ok(globToRegExp('openapi*.{yaml,json}').test('api/openapi.v2.json'))
  assert.ok(!globToRegExp('*.rs').test('src/main.rsx'))
  assert.ok(globToRegExp('**/Migrations/**').test('src/Data/migrations/X.cs'), 'case-insensitive')
})

test('detects ecosystems from marker files anywhere in the repo', () => {
  const names = detectEcosystems(['Cargo.toml', 'apps/web/package.json', 'tools/App.csproj']).map(
    (e) => e.name
  )
  assert.deepEqual(names, ['Rust', 'TypeScript/JavaScript', '.NET'])
  assert.deepEqual(detectEcosystems(['README.md']), [])
})

test('marker files in fixtures, examples or vendored code do not turn a preset on', () => {
  const names = detectEcosystems([
    'Cargo.toml',
    'crates/parser/tests/fixtures/python-project/setup.py',
    'examples/web/package.json',
    'vendor/lib/go.mod',
    'node_modules/left-pad/package.json'
  ]).map((e) => e.name)
  assert.deepEqual(names, ['Rust'])
})

test('Rust + TypeScript repo: monorepo paths land in the expected categories', () => {
  const classify = createClassifier({ ecosystems: eco('Rust', 'TypeScript/JavaScript') })
  const cases: [string, string][] = [
    ['apps/server/src/routes/checkout.rs', 'runtime'],
    ['apps/server/src/routes/checkout_tests.rs', 'tests'],
    ['apps/server/src/routes/cart/tests.rs', 'tests'],
    ['apps/server/tests/fixtures/cart/seed.db', 'tests'],
    ['apps/web/migrations/0004_add_orders.sql', 'migrations'],
    ['.github/workflows/release.yml', 'cicd'],
    ['Cargo.toml', 'dependencies'],
    ['Cargo.lock', 'dependencies'],
    ['apps/web/package.json', 'dependencies'],
    ['apps/web/src/env.d.ts', 'contracts'],
    ['apps/web/src/app.test.ts', 'tests'],
    ['apps/web/wrangler.toml', 'cicd'],
    ['config/feature_flags.toml', 'config'],
    ['rustfmt.toml', 'config'],
    ['docs/architecture.md', 'docs'],
    ['CLAUDE.md', 'docs'],
    ['apps/web/src/index.ts', 'runtime']
  ]
  for (const [path, expected] of cases) assert.equal(classify(path), expected, path)
})

test('presets only apply for detected ecosystems', () => {
  const plain = createClassifier({ ecosystems: [] })
  assert.equal(plain('pkg/server_test.go'), 'runtime')
  assert.equal(createClassifier({ ecosystems: eco('Go') })('pkg/server_test.go'), 'tests')
  assert.equal(
    createClassifier({ ecosystems: eco('Python') })('app/alembic/versions/1a2b_add.py'),
    'migrations'
  )
  assert.equal(createClassifier({ ecosystems: eco('Ruby') })('db/migrate/2024_add_users.rb'), 'migrations')
  assert.equal(createClassifier({ ecosystems: eco('JVM') })('svc/src/test/java/FooTest.java'), 'tests')
})

test('overrides win over attributes and presets; attributes win over presets', () => {
  const classify = createClassifier({
    ecosystems: eco('Rust'),
    overrides: parseOverrides(
      JSON.stringify({ rules: [{ category: 'contracts', paths: ['crates/domain/**'] }] })
    ),
    attributes: new Map([
      ['src/generated/api.rs', { generated: true }],
      ['crates/domain/src/gen.rs', { generated: true }],
      ['guide/setup.rs', { documentation: true }]
    ])
  })
  assert.equal(classify('crates/domain/src/content_proposal.rs'), 'contracts')
  assert.equal(classify('crates/domain/src/gen.rs'), 'contracts')
  assert.equal(classify('src/generated/api.rs'), 'generated')
  assert.equal(classify('guide/setup.rs'), 'docs')
})

test('overrides can turn the presets off', () => {
  const classify = createClassifier({
    ecosystems: eco('Rust'),
    overrides: parseOverrides('{"presets": false, "rules": [{"category": "docs", "paths": ["*.md"]}]}')
  })
  assert.equal(classify('Cargo.toml'), 'runtime')
  assert.equal(classify('README.md'), 'docs')
})

test('invalid overrides name what is wrong', () => {
  assert.throws(() => parseOverrides('{'), /not valid JSON/)
  assert.throws(() => parseOverrides('[]'), /JSON object/)
  assert.throws(
    () => parseOverrides('{"rules": [{"category": "infra", "paths": ["x"]}]}'),
    /rules\[0\]\.category/
  )
  assert.throws(() => parseOverrides('{"rules": [{"category": "docs", "paths": "x"}]}'), /rules\[0\]\.paths/)
  assert.throws(() => parseOverrides('{"presets": "no"}'), /presets/)
})

test('globs inside braces work like globs anywhere else', () => {
  const re = globToRegExp('src/{*.gen.ts,api/**/*.pb.ts}')
  assert.ok(re.test('src/client.gen.ts'))
  assert.ok(re.test('src/api/v1/user.pb.ts'))
  assert.ok(!re.test('src/nested/client.gen.ts'), '* stays inside one folder')
  assert.ok(globToRegExp('*.{yml,yaml}').test('ci/deploy.yaml'))
})

test('overrides with brace globs classify files instead of failing', () => {
  const classify = createClassifier({
    ecosystems: [],
    overrides: parseOverrides('{"rules": [{"category": "generated", "paths": ["src/{*.gen.ts,*.pb.ts}"]}]}')
  })
  assert.equal(classify('src/client.gen.ts'), 'generated')
  assert.equal(classify('src/index.ts'), 'runtime')
})

test('generated files are recognised by name, without .gitattributes', () => {
  const classify = createClassifier({ ecosystems: eco('Rust', 'TypeScript/JavaScript') })
  const cases: [string, string][] = [
    ['app/src/routeTree.gen.ts', 'generated'], // TanStack Router
    ['src/api/client.generated.ts', 'generated'],
    ['src/graphql/__generated__/types.ts', 'generated'],
    ['app/src/MetricPopup.test.tsx', 'tests'],
    ['app/src/metricWidgets.ts', 'runtime'],
    ['src/genome.ts', 'runtime'] // "gen" alone is not a marker
  ]
  for (const [path, expected] of cases) assert.equal(classify(path), expected, path)
})

test('config files with an extra name part are config', () => {
  const classify = createClassifier({ ecosystems: eco('TypeScript/JavaScript') })
  const cases: [string, string][] = [
    ['app/vite.config.screenshot.ts', 'config'],
    ['tailwind.config.dark.mjs', 'config'],
    ['vite.config.ts', 'config'],
    ['src/config.ts', 'runtime'] // a module named config is code
  ]
  for (const [path, expected] of cases) assert.equal(classify(path), expected, path)
})
