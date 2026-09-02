# Changelog

## [2.0.1](https://github.com/csdev19/laqi/compare/v2.0.0...v2.0.1) (2026-09-02)


### Bug Fixes

* **npm:** the package page told users laqi was unreleased ([#44](https://github.com/csdev19/laqi/issues/44)) ([fb8f38b](https://github.com/csdev19/laqi/commit/fb8f38bbf7e5309e15a48e3c5064e0c24032d504))

## [2.0.0](https://github.com/csdev19/laqi/compare/v1.2.1...v2.0.0) (2026-09-02)


### ⚠ BREAKING CHANGES

* drop the prerelease line — the first release is plain 2.0.0
* adopt release-please and publish laqi to npm ([#19](https://github.com/csdev19/laqi/issues/19))

### Features

* adopt release-please and publish laqi to npm ([#19](https://github.com/csdev19/laqi/issues/19)) ([df765c9](https://github.com/csdev19/laqi/commit/df765c9767aadeb3e4b5551f5594cf592c5d2f91))
* audit MCP tool descriptions for agents, scaffold laqi/README.md ([ae94564](https://github.com/csdev19/laqi/commit/ae94564fef77d12c7d5934d5419ae0b3b82fe0ed))
* **cli:** add laqi start as an alias for the default serve mode ([39212c4](https://github.com/csdev19/laqi/commit/39212c4243e5e3d5bcc24a54345d70c437f60d78))
* **cli:** laqi init — five questions, and every flag an agent needs ([#22](https://github.com/csdev19/laqi/issues/22)) ([fecda23](https://github.com/csdev19/laqi/commit/fecda232d7a94e4b5aea1b6b1a05a649034c901f))
* **cli:** laqi start, so the design stops documenting a command that does not exist ([79579ac](https://github.com/csdev19/laqi/commit/79579acf36e21852369e20dc1043c96a2533ed8e))
* **cli:** one rendering layer for start, failures and goodbye ([#21](https://github.com/csdev19/laqi/issues/21)) ([3f20d51](https://github.com/csdev19/laqi/commit/3f20d51c76cba0d9ebc520b8616a5a83b0acf318))
* **cli:** rebuild the init wizard on @clack/prompts ([66ca6a4](https://github.com/csdev19/laqi/commit/66ca6a4c3f510b685084ddd5b771e877c6a7686a))
* data generators — types in 27 languages, mock data from pasted models ([#16](https://github.com/csdev19/laqi/issues/16)) ([a83ab8d](https://github.com/csdev19/laqi/commit/a83ab8d2db7a471ffbf247b8b392682d9b22af2c))
* **init:** replace the hand-rolled prompt with @clack/core ([649691b](https://github.com/csdev19/laqi/commit/649691bf815d021a022bc50639ad502c2bbadff9))
* **mcp:** teach an agent to use laqi without being walked through it ([c042488](https://github.com/csdev19/laqi/commit/c042488b290d94421373657bb4c1ee138174a4a2))
* **site:** laqi.dev — public landing page and docs, first slice ([#33](https://github.com/csdev19/laqi/issues/33)) ([937a1ec](https://github.com/csdev19/laqi/commit/937a1ec7e675fb8c204b43cb6547b2ccd34ffd1d))


### Bug Fixes

* address final-review findings — remaining Spanish and translation defects ([dd5e389](https://github.com/csdev19/laqi/commit/dd5e389e45dee6259ac04b4705af8e3a0ce2aee8))
* closes the fourth owner-reported panel defect. ([61e59e1](https://github.com/csdev19/laqi/commit/61e59e1b683ad6c82122e38fa355f55916635138))
* closes the second owner-reported panel defect. ([038460b](https://github.com/csdev19/laqi/commit/038460b29e5250956e3ca2d89036d07aa7cb7001))
* closes the third owner-reported panel defect. ([f1348fe](https://github.com/csdev19/laqi/commit/f1348fe31be57494e9fac38bb1cc178ac8c3cf66))
* **editor:** a real dialog, readable selections, a favicon, and a clear primary action ([7a5e7dd](https://github.com/csdev19/laqi/commit/7a5e7dde2e48c4ec3d773fe01ac352d7111d9d28))
* **editor:** clarify and elevate the serve action ([61e59e1](https://github.com/csdev19/laqi/commit/61e59e1b683ad6c82122e38fa355f55916635138))
* **editor:** make selected text readable against the panel background ([038460b](https://github.com/csdev19/laqi/commit/038460b29e5250956e3ca2d89036d07aa7cb7001))
* **editor:** replace the native rename prompt with an in-app Dialog ([7226a7a](https://github.com/csdev19/laqi/commit/7226a7a40086abc878c2e531ad53f4ff4511793a))
* **editor:** serve a favicon for the panel ([f1348fe](https://github.com/csdev19/laqi/commit/f1348fe31be57494e9fac38bb1cc178ac8c3cf66))
* **generate:** qty misses the quantity heuristic and generates decimals ([1438213](https://github.com/csdev19/laqi/commit/1438213a2a5e41bbf0bca815ecb3d1dc857719cd))
* **mcp:** describe every tool parameter in the MCP schemas ([bc88184](https://github.com/csdev19/laqi/commit/bc88184c275d11875b27446982e6080a9e83360f))
* **server:** PUT /api/state accepts a scenario that does not exist ([e1c764e](https://github.com/csdev19/laqi/commit/e1c764ebeffe99a92895c8de9312038355477a48))
* **server:** reject undeclared scenarios and overrides in PUT /api/state ([2e3c1c2](https://github.com/csdev19/laqi/commit/2e3c1c2db82dc2ee3bbff6b5d5a0399884522c5f))
* this closes a real defect in unreleased pipeline code — nothing ([df765c9](https://github.com/csdev19/laqi/commit/df765c9767aadeb3e4b5551f5594cf592c5d2f91))
* widen quantity rule to match qty and qtyOrdered field names ([7ebbee8](https://github.com/csdev19/laqi/commit/7ebbee8e7bade4c8aa7213d6221161bcc2b7ca0d))


### Miscellaneous Chores

* drop the prerelease line — the first release is plain 2.0.0 ([54ae9b1](https://github.com/csdev19/laqi/commit/54ae9b14f76aee228db191448c180df4a42b7ea6))
