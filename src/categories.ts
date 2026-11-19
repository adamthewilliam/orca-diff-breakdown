// Category definitions and the built-in, per-ecosystem path presets. Pure data: no I/O.
import type { CategoryId } from './protocol'

/** Display names, in display order: riskiest first. `runtime` is the fallback; `generated` comes from .gitattributes. */
const CATEGORY_NAMES = {
  runtime: 'Runtime',
  tests: 'Tests',
  contracts: 'Contracts',
  migrations: 'DB migrations',
  cicd: 'CI/CD',
  config: 'Config & rollout',
  dependencies: 'Dependencies',
  docs: 'Docs',
  generated: 'Generated'
} satisfies Record<CategoryId, string>

/** Every category in display order. */
export const CATEGORIES: readonly { id: CategoryId; name: string }[] = Object.entries(CATEGORY_NAMES).map(
  ([id, name]) => ({ id: id as CategoryId, name })
)

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && Object.hasOwn(CATEGORY_NAMES, value)
}

/** Globs per category. A pattern without `/` matches the file name in any folder. */
export type RuleSet = Partial<Record<CategoryId, readonly string[]>>

export type Ecosystem = {
  name: string
  /** File names whose presence anywhere in the repo turns this preset on. */
  markers: readonly string[]
  rules: RuleSet
}

/** Applied to every repo, whatever its languages. */
export const COMMON_RULES: RuleSet = {
  migrations: ['**/migrations/**', '**/drizzle/*.sql', '**/drizzle/meta/**'],
  cicd: [
    '.github/workflows/**',
    '.github/actions/**',
    '.github/dependabot.yml',
    '.gitlab-ci.yml',
    '.gitlab/ci/**',
    '.circleci/**',
    '.buildkite/**',
    'azure-pipelines.yml',
    'bitbucket-pipelines.yml',
    'Jenkinsfile',
    'Dockerfile*',
    '*.dockerfile',
    'docker-compose*.yml',
    'docker-compose*.yaml',
    'compose.yml',
    'compose.yaml',
    '.dockerignore',
    'wrangler.toml',
    'wrangler.json',
    'wrangler.jsonc',
    'fly.toml',
    'vercel.json',
    'netlify.toml',
    'railway.json',
    'railway.toml',
    'Procfile',
    '**/k8s/**',
    '**/helm/**',
    '**/terraform/**',
    '*.tf'
  ],
  tests: [
    '**/tests/**',
    '**/test/**',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/__snapshots__/**',
    '**/fixtures/**',
    '**/testdata/**',
    '**/e2e/**'
  ],
  contracts: [
    '*.proto',
    '*.graphql',
    '*.graphqls',
    '*.gql',
    'openapi*.yaml',
    'openapi*.yml',
    'openapi*.json',
    'swagger*.yaml',
    'swagger*.yml',
    'swagger*.json',
    '*.schema.json',
    '*.avsc',
    '*.thrift',
    '*.wit'
  ],
  config: [
    '*.toml',
    '*.yaml',
    '*.yml',
    '*.ini',
    '*.cfg',
    '*.conf',
    '*.properties',
    '.env*',
    '*.config.js',
    '*.config.cjs',
    '*.config.mjs',
    '*.config.ts',
    '*.config.mts',
    '.*rc',
    '.*rc.json',
    '.*rc.js',
    '.*rc.cjs',
    '.*rc.yml',
    '.*rc.yaml',
    'tsconfig*.json',
    'jsconfig*.json',
    '.editorconfig',
    '.gitignore',
    '.gitattributes',
    'CODEOWNERS',
    'Makefile',
    'justfile',
    '.orca/**',
    '**/feature_flags*',
    '**/feature-flags/**',
    '**/flags/**'
  ],
  docs: ['*.md', '*.mdx', '*.rst', '*.adoc', '**/docs/**', '**/doc/**', 'LICENSE*', 'CHANGELOG*', 'NOTICE*']
}

export const ECOSYSTEMS: readonly Ecosystem[] = [
  {
    name: 'Rust',
    markers: ['Cargo.toml'],
    rules: {
      tests: ['*_tests.rs', '*_test.rs', 'tests.rs', '**/benches/**'],
      dependencies: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain', 'rust-toolchain.toml', 'deny.toml'],
      config: ['rustfmt.toml', '.rustfmt.toml', 'clippy.toml', '.cargo/config.toml']
    }
  },
  {
    name: 'TypeScript/JavaScript',
    markers: ['package.json'],
    rules: {
      tests: ['*.test.*', '*.spec.*', '*.e2e.*', '**/cypress/**', '**/playwright/**'],
      dependencies: [
        'package.json',
        'package-lock.json',
        'npm-shrinkwrap.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'bun.lock',
        'bun.lockb',
        'deno.lock',
        '.npmrc',
        '.nvmrc',
        '.node-version'
      ],
      contracts: ['*.d.ts', '*.d.mts', '*.d.cts'],
      migrations: ['**/prisma/migrations/**']
    }
  },
  {
    name: 'Python',
    markers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
    rules: {
      tests: ['test_*.py', '*_test.py', 'conftest.py', 'tox.ini', 'pytest.ini'],
      dependencies: [
        'pyproject.toml',
        'poetry.lock',
        'uv.lock',
        'pdm.lock',
        'requirements*.txt',
        'requirements/**',
        'Pipfile',
        'Pipfile.lock',
        'setup.py',
        'setup.cfg',
        '.python-version'
      ],
      migrations: ['**/alembic/versions/**'],
      contracts: ['*.pyi']
    }
  },
  {
    name: 'Go',
    markers: ['go.mod'],
    rules: {
      tests: ['*_test.go'],
      dependencies: ['go.mod', 'go.sum', 'go.work', 'go.work.sum']
    }
  },
  {
    name: 'JVM',
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    rules: {
      tests: [
        '**/src/test/**',
        '**/src/androidTest/**',
        '*Test.java',
        '*Test.kt',
        '*Tests.java',
        '*Tests.kt'
      ],
      dependencies: [
        'pom.xml',
        'build.gradle',
        'build.gradle.kts',
        'settings.gradle',
        'settings.gradle.kts',
        'gradle.lockfile',
        '**/gradle/libs.versions.toml',
        '**/gradle/wrapper/**'
      ],
      migrations: ['**/db/migration/**', '**/db/changelog/**']
    }
  },
  {
    name: '.NET',
    markers: ['*.csproj', '*.fsproj', '*.sln'],
    rules: {
      tests: ['**/*.Tests/**', '**/*.UnitTests/**', '**/*.IntegrationTests/**', '*Tests.cs'],
      dependencies: [
        '*.csproj',
        '*.fsproj',
        '*.sln',
        'packages.lock.json',
        'Directory.Packages.props',
        'Directory.Build.props',
        'nuget.config',
        'global.json'
      ]
    }
  },
  {
    name: 'Swift',
    markers: ['Package.swift', 'Podfile'],
    rules: {
      tests: ['**/Tests/**', '*Tests.swift', '*UITests.swift'],
      dependencies: [
        'Package.swift',
        'Package.resolved',
        'Podfile',
        'Podfile.lock',
        'Cartfile',
        'Cartfile.resolved'
      ]
    }
  },
  {
    name: 'Ruby',
    markers: ['Gemfile'],
    rules: {
      tests: ['**/spec/**', '*_spec.rb', '*_test.rb'],
      dependencies: ['Gemfile', 'Gemfile.lock', '*.gemspec', '.ruby-version'],
      migrations: ['**/db/migrate/**', '**/db/schema.rb', '**/db/structure.sql']
    }
  },
  {
    name: 'PHP',
    markers: ['composer.json'],
    rules: {
      tests: ['*Test.php', 'phpunit.xml*'],
      dependencies: ['composer.json', 'composer.lock'],
      migrations: ['**/database/migrations/**']
    }
  },
  {
    name: 'Elixir',
    markers: ['mix.exs'],
    rules: {
      tests: ['*_test.exs'],
      dependencies: ['mix.exs', 'mix.lock'],
      migrations: ['**/priv/repo/migrations/**']
    }
  }
]

/** Which category wins when a file matches several: earlier wins. `runtime` is never matched. */
export const PRECEDENCE: readonly CategoryId[] = [
  'migrations',
  'cicd',
  'dependencies',
  'tests',
  'contracts',
  'config',
  'docs'
]
