node_modules/url-dirname-normalizer/main.cjs:
		npm i

.DEFAULT: run
.PHONY: run
run: node_modules/url-dirname-normalizer/main.cjs
	node main.cjs

