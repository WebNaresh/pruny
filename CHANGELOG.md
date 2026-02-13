# [1.14.0](https://github.com/webnaresh/pruny/compare/v1.13.0...v1.14.0) (2026-02-13)


### Features

* remove used routes references from output ([bdf0991](https://github.com/webnaresh/pruny/commit/bdf09912b6ed75b7dc3a6ffdfd7e7f68df47f702))
* reorder CLI output to keep Summary Table at the bottom ([0a99f18](https://github.com/webnaresh/pruny/commit/0a99f187d76dbf8141967d94830dbe7471f49107))

# [1.13.0](https://github.com/webnaresh/pruny/compare/v1.12.0...v1.13.0) (2026-02-13)


### Features

* ignore service worker files as entry points in monorepos ([2b199c5](https://github.com/webnaresh/pruny/commit/2b199c586719025471055f0c535713143af5717b))

# [1.12.0](https://github.com/webnaresh/pruny/compare/v1.11.0...v1.12.0) (2026-02-13)


### Features

* ignore config files and Next.js metadata as entry points ([c7034ec](https://github.com/webnaresh/pruny/commit/c7034ec3f5e48593255e77076e90c54def6a841b))

# [1.11.0](https://github.com/webnaresh/pruny/compare/v1.10.1...v1.11.0) (2026-02-13)


### Features

* Expand ignored files list in unused file scanner to include more Next.js specific and generic configuration files. ([c5aba4e](https://github.com/webnaresh/pruny/commit/c5aba4e0ecf3c2566d761f909afcb5268bc0b7ec))

## [1.10.1](https://github.com/webnaresh/pruny/compare/v1.10.0...v1.10.1) (2026-02-13)


### Bug Fixes

* Improve unused export and file detection by ignoring comments, template literals, and string literals, and enhancing code pattern matching to include TypeScript generics. ([4fdee50](https://github.com/webnaresh/pruny/commit/4fdee506b401511062f6bf32be5951b135948223))

# [1.10.0](https://github.com/webnaresh/pruny/compare/v1.9.2...v1.10.0) (2026-02-13)


### Features

* add worker thread parallelization for 22x faster scans on large codebases ([0ce6489](https://github.com/webnaresh/pruny/commit/0ce6489f6f9e4c4d5e948ae03ce89d8a27cbba9c))

## [1.9.2](https://github.com/webnaresh/pruny/compare/v1.9.1...v1.9.2) (2026-02-13)


### Bug Fixes

* add template literal tracking to prevent false positives in multi-line backtick strings ([630221b](https://github.com/webnaresh/pruny/commit/630221b03d89d25952fd73c2e950f06a1ba74363))

## [1.9.1](https://github.com/webnaresh/pruny/compare/v1.9.0...v1.9.1) (2026-02-13)


### Bug Fixes

* use glob patterns (**/proxy.*, **/middleware.*) for proper ignore matching and add proxy to entry patterns ([aa00709](https://github.com/webnaresh/pruny/commit/aa007090a511d7eabef76483612ac64e46cadbfe))

# [1.9.0](https://github.com/webnaresh/pruny/compare/v1.8.0...v1.9.0) (2026-02-13)


### Features

* show current filename in progress output and use glob patterns for ignore ([a21d1f2](https://github.com/webnaresh/pruny/commit/a21d1f2fecc2ec64fa3b73579cadf452ab830936))

# [1.8.0](https://github.com/webnaresh/pruny/compare/v1.7.1...v1.8.0) (2026-02-13)


### Features

* add progress indicators and expand build directory ignore patterns ([388dbc5](https://github.com/webnaresh/pruny/commit/388dbc54aded9a1627e1cb59da5246ce328ec5bd))

## [1.7.1](https://github.com/webnaresh/pruny/compare/v1.7.0...v1.7.1) (2026-02-13)


### Performance Improvements

* fix catastrophic backtracking in string literal stripping regex ([ea8b924](https://github.com/webnaresh/pruny/commit/ea8b9240b1f6ed4246a7132576e6946f1f84707e))

# [1.7.0](https://github.com/webnaresh/pruny/compare/v1.6.0...v1.7.0) (2026-02-13)


### Features

* improve filter to prioritize exact path segment matches and update help text ([c708b55](https://github.com/webnaresh/pruny/commit/c708b55ecfde2a307b74f6b50bda0ebcd9a509f5))

# [1.6.0](https://github.com/webnaresh/pruny/compare/v1.5.0...v1.6.0) (2026-02-13)


### Bug Fixes

* process multiple exports in same file in single run by sorting in reverse line order ([d209451](https://github.com/webnaresh/pruny/commit/d20945185066c395a64ea9d034fce7dc23da4266))


### Features

* improve export usage detection to ignore string literals and require code context ([cf559d3](https://github.com/webnaresh/pruny/commit/cf559d3035a83259787c3a1020e4c737f6e12116))

# [1.5.0](https://github.com/webnaresh/pruny/compare/v1.4.0...v1.5.0) (2026-02-13)


### Features

* delete entire unused declarations instead of just removing export keyword ([2edb1b9](https://github.com/webnaresh/pruny/commit/2edb1b93c949168cf0225f979a1ed00e1d2fd26c))

# [1.4.0](https://github.com/webnaresh/pruny/compare/v1.3.0...v1.4.0) (2026-02-13)


### Features

* add execution time display ([773cab0](https://github.com/webnaresh/pruny/commit/773cab06a39a0cd1e59f737507ab1fc8d48bc3ff))

# [1.3.0](https://github.com/webnaresh/pruny/compare/v1.2.14...v1.3.0) (2026-02-13)


### Bug Fixes

* remove registry-url from setup-node for semantic-release compatibility ([e96c04a](https://github.com/webnaresh/pruny/commit/e96c04a2b4f50fb49281025a4578e8f618b9c782))


### Features

* add semantic versioning with automated changelog generation ([bda0f61](https://github.com/webnaresh/pruny/commit/bda0f613be3c8fd94cb916d2c5258ef9e2c53b94))
* integrate semantic-release for automated versioning, changelog generation, and GitHub releases. ([ab397a6](https://github.com/webnaresh/pruny/commit/ab397a670de7d9dd3e80b05c5892e1eb3af80e5f))

# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).
