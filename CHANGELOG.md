# [1.28.0](https://github.com/webnaresh/pruny/compare/v1.27.0...v1.28.0) (2026-02-14)


### Features

* Adjust HTTP usage scanner to include the public folder and remove default ignore patterns from the configuration. ([d05e398](https://github.com/webnaresh/pruny/commit/d05e398322544db6d93c136de7af9c44c67d1f07))

# [1.27.0](https://github.com/webnaresh/pruny/compare/v1.26.0...v1.27.0) (2026-02-14)


### Features

* Enhance HTTP client detection regex patterns to correctly parse calls with TypeScript type arguments. ([be45828](https://github.com/webnaresh/pruny/commit/be458281e931210be05f090618fddc676287783c))

# [1.26.0](https://github.com/webnaresh/pruny/compare/v1.25.0...v1.26.0) (2026-02-14)


### Bug Fixes

* prevent http-usage scanner from ignoring files based on `config.ignore.files`. ([ee64a28](https://github.com/webnaresh/pruny/commit/ee64a28559eb95fcc72120bb7d0227baf06fa2a9))


### Features

* Add HTTP client usage scanner for Axios, Fetch, Got, and Ky, and display their counts in the scan results. ([a1876ea](https://github.com/webnaresh/pruny/commit/a1876ea8a88734d16771949477ee47596d3a1069))

# [1.25.0](https://github.com/webnaresh/pruny/compare/v1.24.0...v1.25.0) (2026-02-14)


### Features

* Implement `--ignore-apps` CLI option to exclude specified monorepo applications from scanning and refactor `PrunyOptions` and `PrunyConfig` type definitions. ([7841f01](https://github.com/webnaresh/pruny/commit/7841f0167b6f3540f12a1111454581fef4cccea5))

# [1.24.0](https://github.com/webnaresh/pruny/compare/v1.23.0...v1.24.0) (2026-02-14)


### Features

* Add monorepo support by detecting applications and performing per-app scanning and fixing with dynamic configuration. ([9f74e61](https://github.com/webnaresh/pruny/commit/9f74e6137e4a36af51501e230f9e63015cb7b871))

# [1.23.0](https://github.com/webnaresh/pruny/compare/v1.22.0...v1.23.0) (2026-02-14)


### Features

* Introduce app-specific scanning to narrow route discovery to a single application directory while continuing project-wide reference analysis. ([0ce6453](https://github.com/webnaresh/pruny/commit/0ce6453babc5ec657496dad2825f15d40bdb96cd))

# [1.22.0](https://github.com/webnaresh/pruny/compare/v1.21.1...v1.22.0) (2026-02-13)


### Features

* improve method definition detection by adding regex and name-based checks. ([b2e15d8](https://github.com/webnaresh/pruny/commit/b2e15d872e3915b61b15ee15b129f5efe056c01b))

## [1.21.1](https://github.com/webnaresh/pruny/compare/v1.21.0...v1.21.1) (2026-02-13)


### Bug Fixes

* Improve declaration index finding by converting HTTP verbs to NestJS decorator format for accurate matching. ([903b382](https://github.com/webnaresh/pruny/commit/903b3822acd81b3590f28dfa924fe36302b81678))

# [1.21.0](https://github.com/webnaresh/pruny/compare/v1.20.0...v1.21.0) (2026-02-13)


### Features

* Improve unused export deletion and export keyword removal by enhancing declaration finding and deletion logic. ([5e6f4b6](https://github.com/webnaresh/pruny/commit/5e6f4b65e714f7c21ba4c6754fef40e998565bd7))

# [1.20.0](https://github.com/webnaresh/pruny/compare/v1.19.0...v1.20.0) (2026-02-13)


### Features

* Enhance unused export scanning to detect NestJS service methods and refine ignored HTTP method exports. ([35c5a8f](https://github.com/webnaresh/pruny/commit/35c5a8fdd87f6bdc4c37072e2637b95737f73e12))

# [1.19.0](https://github.com/webnaresh/pruny/compare/v1.18.0...v1.19.0) (2026-02-13)


### Features

* enhance API route matching by supporting template literals in patterns and improving NestJS path variation detection. ([020143f](https://github.com/webnaresh/pruny/commit/020143f127546b5e6828dde065196e2c6827236f))

# [1.18.0](https://github.com/webnaresh/pruny/compare/v1.17.1...v1.18.0) (2026-02-13)


### Features

* Enhance ignore pattern matching in `shouldIgnore`, apply route ignores to both API and file paths, and remove automatic `**` prefixing for route ignore patterns. ([cd21adf](https://github.com/webnaresh/pruny/commit/cd21adf2a0a16c52a3a7fac146b3f1668acbfb64))
* Enhance unused route deletion by grouping routes by file and selectively pruning methods from internally used NestJS files. ([6a23640](https://github.com/webnaresh/pruny/commit/6a23640535d2839b1cc4c7cb36c3a3a3ad3b1180))

## [1.17.1](https://github.com/webnaresh/pruny/compare/v1.17.0...v1.17.1) (2026-02-13)


### Bug Fixes

* Prevent deletion of internally used NestJS files and improve glob pattern matching for ignore configurations. ([ec1bdc6](https://github.com/webnaresh/pruny/commit/ec1bdc6fe6a0cb70f67bdc834696d551de4b5f87))

# [1.17.0](https://github.com/webnaresh/pruny/compare/v1.16.0...v1.17.0) (2026-02-13)


### Features

* Enhance API endpoint detection by refining regex patterns to capture full paths and adding generic path matching, and consolidate test file entry point glob patterns. ([682e920](https://github.com/webnaresh/pruny/commit/682e92076308af0e36e89bdc0e175cc814cd4853))

# [1.16.0](https://github.com/webnaresh/pruny/compare/v1.15.1...v1.16.0) (2026-02-13)


### Features

* Implement framework-specific unused route deletion, add NestJS path normalization, expand ignored file patterns, and improve file operation robustness. ([adec359](https://github.com/webnaresh/pruny/commit/adec359e4d61a1c295d1ea2386f2acd8d00107d3))

## [1.15.1](https://github.com/webnaresh/pruny/compare/v1.15.0...v1.15.1) (2026-02-13)


### Bug Fixes

* ensure Summary Report reflects post-fix state and implement unused source file deletion ([e2ead6b](https://github.com/webnaresh/pruny/commit/e2ead6b9cc8275736ee072bff2322181ad8f7ada))

# [1.15.0](https://github.com/webnaresh/pruny/compare/v1.14.0...v1.15.0) (2026-02-13)


### Features

* implement surgical removal of unused API methods with --fix ([eb7373e](https://github.com/webnaresh/pruny/commit/eb7373ea78d53129400bf224fbca90c58fafd4d6))

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
