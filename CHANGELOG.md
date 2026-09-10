# Changelog

## [2.1.0](https://github.com/csdev19/laqi/compare/v2.0.1...v2.1.0) (2026-09-10)


### Features

* a response remembers its schema, and cannot be overwritten by accident ([193e018](https://github.com/csdev19/laqi/commit/193e018701a0903fd588f4b80632c793f0f535e3))
* **core:** make a response's body replaceable without losing someone else's edit ([4a83bba](https://github.com/csdev19/laqi/commit/4a83bbaffc186f683fd7abaf83a3d2d42cc63b38))
* **core:** write mock files with a JSON-aware layout ([7778cd9](https://github.com/csdev19/laqi/commit/7778cd9e95a01176d16aa206f7ada13e9a64e805))
* **editor:** a small TypeScript editor for pasted models, plus example models ([744fbd9](https://github.com/csdev19/laqi/commit/744fbd9336f5c95a1b1d0885f78a2ccd2c4bed95))
* **editor:** add a JSON body flow, and refuse a status that is not a code ([4b9373e](https://github.com/csdev19/laqi/commit/4b9373e79ec5ef3fc18fa6e2fd4b911a9367801d))
* **editor:** add a status combobox that names every code it offers ([33fac52](https://github.com/csdev19/laqi/commit/33fac52ac15661dcf9cb9692bc8a9d448ffb5d24))
* **editor:** apply a generated body deliberately, and answer a refusal in place ([5f9ce1e](https://github.com/csdev19/laqi/commit/5f9ce1e724cc32f39b760de86c5c63b54604d8e4))
* **editor:** build a model from a body that has none, and edit it first ([5ccbe3a](https://github.com/csdev19/laqi/commit/5ccbe3a2e1186f4f2f09072c73c8a7b6a7a08b64))
* **editor:** choose which type a model generates from, and say which one it used ([00001c3](https://github.com/csdev19/laqi/commit/00001c38030f71f1433cb498cdbf40361a591426))
* **editor:** compare both bodies before replacing one ([7c2a38e](https://github.com/csdev19/laqi/commit/7c2a38e7fe2cd304be33deb88f01ab11f63f8419))
* **editor:** draft a model in the body's own key order, and colour the comparison ([f655344](https://github.com/csdev19/laqi/commit/f655344b6cce96841b0f903b589f1d988876a88a))
* **editor:** let a generated response be named and numbered like any other ([de14c74](https://github.com/csdev19/laqi/commit/de14c74698c6a3fca2e297be77e871a9888af511))
* **editor:** let a response's schema be rebuilt from its body ([5d19aa1](https://github.com/csdev19/laqi/commit/5d19aa159320da2fc588077e552306da5421373f))
* **editor:** let Create explain itself instead of greying out ([58f5be0](https://github.com/csdev19/laqi/commit/58f5be03c2f1d1f664a41ec3b2ccccb5c4383258))
* **editor:** make the model box a small TypeScript editor ([94f4aaa](https://github.com/csdev19/laqi/commit/94f4aaae22392b7131d001285edfb4c489a19473))
* **editor:** offer the three example models under the model box ([a17a639](https://github.com/csdev19/laqi/commit/a17a639dc70aa2f48923f918f3b82e14f9950075))
* **editor:** say where to go from the panel that shows the model ([88d9f64](https://github.com/csdev19/laqi/commit/88d9f64a65c33c180a5a82998fc7b13f9c771f5d))
* **editor:** use the status combobox, and offer the missing response siblings ([a63fab7](https://github.com/csdev19/laqi/commit/a63fab778426f9fba99ca17ec8f1b7eb8abe0a84))
* **examples:** add a flat model and two JSON bodies, one mirroring the other ([bd472db](https://github.com/csdev19/laqi/commit/bd472db94743a38a41c561eebe0c0b8e5223217e))
* **generate:** compile a JSON Schema document into a generation plan ([0e88937](https://github.com/csdev19/laqi/commit/0e8893772a83aeb3f4746f8355d035a23bb7b77e))
* **generate:** honour the additive keywords, or refuse them by name ([0fc540d](https://github.com/csdev19/laqi/commit/0fc540d77fdf8e88f2610a61846d784c3ac54907))
* **generate:** import a source into a snapshot, under one loss policy ([a3a6632](https://github.com/csdev19/laqi/commit/a3a6632a4ba37b9f393306b4a9f1aa45677f73f9))
* **generate:** normalize dialects and resolve references inside a document ([a073729](https://github.com/csdev19/laqi/commit/a0737298cccdf1386f632b10c2be758199e50eab))
* **generate:** print TypeScript from a schema in the schema's own order ([e96a5ff](https://github.com/csdev19/laqi/commit/e96a5ff74b9beef2af4103784c5d3f8c0ad43f7a))
* import OpenAPI through the real compiler, and export what a target can hold ([4697393](https://github.com/csdev19/laqi/commit/4697393d9fb8f5c2e447e9a63f20b872b4214413))
* **mcp:** add scaffold_responses so agents get the same one call ([e5c5219](https://github.com/csdev19/laqi/commit/e5c52195d876b8bba3df5d87934649cbfd187d2f))
* **mcp:** regenerate, apply and refresh, under the same rules as the panel ([8fc233d](https://github.com/csdev19/laqi/commit/8fc233d3f02fdfb3fcd0febb0ca573b48f49a3d3))
* measure the schema pipeline, and check the runtimes it ships on ([505176d](https://github.com/csdev19/laqi/commit/505176dbdda0d42d7d70b1b669f68adf99badee6))
* mock files remember the model a body was generated from ([897f2b7](https://github.com/csdev19/laqi/commit/897f2b70d78769d05fb8889825caffd25f6ef8c8))
* mock files remember the model a body was generated from ([7955a85](https://github.com/csdev19/laqi/commit/7955a856dbad69dda0058ed5defa1d28ceff3791))
* persist a response's schema, and stop guessing when it has none ([b2e8e78](https://github.com/csdev19/laqi/commit/b2e8e7809678d8f692c352a23bfa5be1165a5cdc))
* phases 1-3 of the JSON Schema adapters spec ([58325bb](https://github.com/csdev19/laqi/commit/58325bbcb7ce2e161038da673695557fc327c369))
* read a schema out of the project's own code, behind two gates ([0298f28](https://github.com/csdev19/laqi/commit/0298f28cbfc57f722e957e889f98adfeedd7ae11))
* response scaffolding and a status select that names its codes ([67007bb](https://github.com/csdev19/laqi/commit/67007bba5908d619a261304ea071fe4db292fa41))
* **schema:** add the status-code catalogue and one statusClass ([350077b](https://github.com/csdev19/laqi/commit/350077b25c9fec5c005a515878a31f4148fd9613))
* **schema:** declare the persisted schema, diagnostic and evidence contracts ([afbbcfb](https://github.com/csdev19/laqi/commit/afbbcfb7caa31e93a18134a7707d6dbf0da65652))
* **schema:** suggest the response family a method and path shape imply ([09cd46f](https://github.com/csdev19/laqi/commit/09cd46fac2e6968dc94e1ff162a44a51c12f6ff3))
* **server:** import, preview, regenerate, apply and refresh over HTTP ([f02ee9a](https://github.com/csdev19/laqi/commit/f02ee9a86da20a357d3276448b517c129e4050ba))


### Bug Fixes

* **core:** confine writes to the mocks directory, not the working directory ([8f70f6a](https://github.com/csdev19/laqi/commit/8f70f6a18d3284384e6488acb2213815d48a55a4))
* **core:** confine writes to the mocks directory, not the working directory ([50718f4](https://github.com/csdev19/laqi/commit/50718f4b0ad4541304ffb21a051a68ea850b2701))
* **editor:** keep the painted layer with the text when the field scrolls ([d60a6cc](https://github.com/csdev19/laqi/commit/d60a6ccd902b02f995c5d64224e216c0df7cadea))
* **editor:** make the overwrite confirmation answerable ([0133029](https://github.com/csdev19/laqi/commit/0133029b43406fde095f1a8c4d17acaf0a8af601))
* **editor:** only name the generated type when the parser had a choice ([39a2089](https://github.com/csdev19/laqi/commit/39a2089bac24ba984f14f09520c55d2478d2e5d3))
* **editor:** only name the generated type when the parser had a choice ([c445ad8](https://github.com/csdev19/laqi/commit/c445ad82ee897cf1a923165451a7edd2feccb657))
* **editor:** show a refused replace as a warning callout, not a subtitle ([5b2685d](https://github.com/csdev19/laqi/commit/5b2685d72be17aef9f3a7f748c9221bcfbcc9db7))
* **generate:** clear the two lint errors in the compiler tests ([595dfa4](https://github.com/csdev19/laqi/commit/595dfa444288aaa9e692c08ccb3e5095dc00327a))
* **generate:** close the parse, budget and shape-validation holes ([f7cd764](https://github.com/csdev19/laqi/commit/f7cd76448f3e3de6139195508ddf9e26a73f8289))
* **generate:** close the parse, budget and shape-validation holes ([fdf4547](https://github.com/csdev19/laqi/commit/fdf4547111e9a68cbd6cf0f2816293f1e67c3542))
* **generate:** make the exported Effect programs actually runnable ([cb729dc](https://github.com/csdev19/laqi/commit/cb729dc20cb98a2a85067b9ccfc13c0d0949640c))
* **generate:** stop exporting a module that is not in the repository ([9720f69](https://github.com/csdev19/laqi/commit/9720f69843236a1c2786b438e1783a9c4dfb8d33))
* **generate:** use sort(), which exists at this project's ES2022 target ([7dc1753](https://github.com/csdev19/laqi/commit/7dc17537c8bf4600cc17a6bf3124fdcdd2cfd640))


### Code Refactoring

* **generate:** make faker and quicktype services too ([720d296](https://github.com/csdev19/laqi/commit/720d296074195eedb0d22546f20abecdbc248d0d))
* **generate:** make the heavy dependencies Effect services ([09b2250](https://github.com/csdev19/laqi/commit/09b225004e4a0e7cf11a91f4f2a81211a6334b8c))
* **generate:** make the TypeScript compiler a service ([5fb026e](https://github.com/csdev19/laqi/commit/5fb026e8087bb7bfaaed7f988cb6db2d3805a8e7))
* **generate:** separate the generation plan from the Shape ([66482a5](https://github.com/csdev19/laqi/commit/66482a599ef1b2ffa48f241c4041467d18f0000d))

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
