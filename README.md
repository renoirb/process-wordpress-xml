# Extract WordPress Contents by processing WordPress’ XML backup

Process WordPress XML backup and create Markdown text files for each pages and
posts

## Example usage

Files gets generated as Markdown in `out/*` folder. Each file is as they are in
WordPress with HTML, and WordPress short codes.

It is assuming that most pages are in the format `/blog/YYYY/mm/post-url-slug`
where `YYYY` is full 4-digit year (e.g. 2020) and `mm` is a 2-digit month number
where `01` is for January and `12` for December.

Assuming we have a page or a post with URL path as `/about` in WordPress, we
should see a file that looks like this

```markdown[out/about.md]
---
title: À propos
locale: fr-CA
created: '2009-07-09'
updated: '2023-02-18'
canonical: https://renoirboulanger.com/about/
status: publish
revising: true
categories: []
tags: []
keywords: []
excerpt: ''
title_alternate: À propos de Renoir Boulanger, Un geek social et Linuxien de nature
---

<h2>This is my about page</h2>

<p>Here is a photo of me while I was presenting at a conference.</p>
```

## Other projects with similar objectives

- https://github.com/eiskalteschatten/export-wordpress-to-markdown?tab=readme-ov-file
