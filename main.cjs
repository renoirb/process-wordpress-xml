const { readFile, mkdirSync, writeFileSync } = require('fs')
const { join, resolve, split, basename } = require('path')
const { createHash } = require('node:crypto')
const parser = require('xml2json')
const phpUnserialize = require('phpunserialize')
const { dirnameNormalizer, pathName } = require('url-dirname-normalizer')
const TurndownService = require('turndown')
const turndownPluginGfm = require('turndown-plugin-gfm')
const { dump } = require('js-yaml')
const {
  helpers: { coerceIso8601DashLessNotation },
} = require('@renoirb/date-epoch')

const PREFIX_TO_HIDE_IN_STDOUT = process.cwd()

const PREFIX_TO_HIDE_IN_HOSTNAME = 'https://renoirboulanger.com/' // Change Me!

const STOP_WORDS_ENGLISH = Object.freeze([
  'about',
  'add',
  'and',
  'few',
  'for',
  'from',
  'in',
  'into',
  'key',
  'leaving',
  'make',
  'run',
  'share',
  'the',
  'thing',
  'was',
  'with',
  'your',
])

const REGEX_CONTAINS_STOP_WORDS_ENGLISH = new RegExp(
  `\\b(?:${STOP_WORDS_ENGLISH.join('|')})\\b`,
  'i',
)

const PATHS_I_DO_NOT_CARE = [
  '/cv/',
  '/home/',
  '/renoirb/',
  '/resume/',
  '/resume/detailed/',
]

const md5 = (str) => createHash('md5').update(str).digest('hex')

const csvItemMapFn = (i) => {
  let out = ''
  switch (true) {
    case Number.isSafeInteger(+i):
      out = i
      break

    case !/^http/.test(i):
      out = `"${encodeURI(i)}"`
      break

    default:
      out = i
      break
  }
  return out
}
const sortExportedUrls = (a, b) => {
  const left = a[0]
  const right = b[0]
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }

  // names must be equal
  return 0
}

// https://github.com/mixmark-io/turndown?tab=readme-ov-file#options
var mds = new TurndownService({
  preformattedCode: true,
  codeBlockStyle: 'fenced',
})
var gfm = turndownPluginGfm.gfm
mds.use(gfm)

// https://github.com/mixmark-io/turndown?tab=readme-ov-file#addrulekey-rule
mds.addRule('code', {
  filter: ['pre', 'code'],
  replacement: (content) => {
    return '`' + content + '`'
  },
})
mds.addRule('code-fence', {
  filter: ['tt'],
  replacement: (content) => {
    return '\n```\n' + content + '\n```\n'
  },
})

mds.addRule('paragraph', {
  filter: ['p'],
  replacement: (content) => {
    return '\n\n' + content + '\n\n'
  },
})
const toMarkdown = (c) => mds.turndown(c)

const unescapeUrlPath = (str) =>
  (str ?? '')
    .split(/(%[0-9A-Fa-f]{2})/g)
    .map((part) => {
      if (/%[0-9A-Fa-f]/.test(part)) {
        part = unescape(part)
      }
      return part
    })
    .join('')

const REDICRECTS_MAP = new Map()
REDICRECTS_MAP.set(/*pathNormalized*/ '/home/', { to: '/blog/' })
REDICRECTS_MAP.set(/*pathNormalized*/ '/renoirb/', { to: '/blog/' })
REDICRECTS_MAP.set(
  /*pathNormalized*/ '/blog/2009/11/realisation-du-site-et-de-limage-c2abbrandingc2bb-de-beebox-2008/',
  { to: '/blog/2009/11/realisation-2008-du-site-et-branding-de-beebox/' },
)
REDICRECTS_MAP.set(
  /*pathNormalized*/ '/blog/2010/01/le-manifeste-open-cloud-pour-standardiser-linformatique-c2abdans-les-nuagesc2bb/',
  {
    to: '/blog/2010/01/le-open-cloud-manifest-pour-standardiser-linformatique-dans-le-nuage/',
  },
)
REDICRECTS_MAP.set(
  /*pathNormalized*/ '/blog/2010/01/le-defi-c2abproject52c2bb-un-billet-par-semaine-minimum/',
  {
    to: '/blog/2010/01/le-defi-project52-pour-un-billet-de-blogue-par-semaine/',
  },
)
REDICRECTS_MAP.set(
  /*pathNormalized*/ '/blog/2010/02/realisation-dune-application-dechange-de-cadeau-avec-red-lagence-le-c2abclub-echangistec2bb-2009/',
  {
    to: '/blog/2010/02/realisation-2009-application-echange-de-cadeau-avec-agence-red/',
  },
)

const redirects = []

const posts = []
const attachments = []
const pages = []
const unpublished = []
const comments = []
const oddities = []

const exported_urls = []

let channel = {}

let count = 0

/**
 * See also:
 * - https://github.com/jonhoo/wp2ghost/blob/e25d81e8/lib/wp2ghost.js#L57-L159
 */
// wp:status
const wpStatus = new Set(['trash', 'draft', 'inherit', 'private', 'publish'])
// wp:post_type
const wpPostType = new Set(['attachment', 'nav_menu_item', 'page', 'post'])

const PHP_STRING_SERIALIZED = [
  'akismet_history',
  '_social_aggregated_ids',
  '_social_aggregation_log',
  '_social_broadcasted_ids',
  '_social_broadcast_meta',
  '_social_broadcast_content',
  '_wp_attachment_metadata',
  '_menu_item_classes',
  '_wp_attachment_backup_sizes',
]

const normalizeKey = (k) => k.split(':')[1] ?? k

const normalizePaths = (input) => {
  return input
    .replace(/^(https?:\/\/)?/, '')
    .replace(/renoirboulanger\.com\//, '')
    .replace(/(?!\/)$/, '/')
    .replace(/^(?!\/)/, '/')
    .replace(/\/\/$/, '/')
}

const normalizePublicationStatusStringFor = (p) => {
  const _status = p.get('status')

  // xxx Unfinished, should we rename the statuses?

  let pageSelector = 'publish'
  // pageSelector = 'private'
  // pageSelector = 'draft'
  let postSelector = 'publish'
  // postSelector = 'private'
  // postSelector = 'draft'
  // postSelector = 'trash'

  return _status
}

const extractFullyQualifiedPath = (p) => {
  let postPath = p.get('path')
  if (typeof postPath === 'string' && /^\//.test(postPath) && postPath !== '') {
    const children = postPath
      .split('/')
      .filter((p) => p !== '')
      .join('/')
    const folderPath = join(__dirname, 'out', children)
    postPath = resolve(folderPath)
  }
  return postPath
}

const createDocumentContents = (p) => {
  const title = p.get('title')
  const canonical = p.get('link')
  const created = p.get('date').split(' ')[0]
  const updated = p.get('modified').split(' ')[0]
  const tags = extractFromCategory(p, 'post_tag')
  const categories = extractFromCategory(p, 'category')
  const content = p.get('content')
  const _excerpt = p.get('excerpt')

  const excerpt = toMarkdown(_excerpt)

  let locale = 'fr-CA'
  if (REGEX_CONTAINS_STOP_WORDS_ENGLISH.test(title)) {
    locale = 'en-CA'
  }

  const status = normalizePublicationStatusStringFor(p)
  return [
    {
      title,
      locale,
      created,
      updated,
      canonical,
      status,
      revising: true,
      categories,
      tags,
      keywords: [],
      excerpt,
    },
    content,
  ]
}

/**
 *
 * @example How data looks like when returned by this function
 *
 * ```
 * new Map({
 *  'postType' => 'post',
 *  'content' => '...',
 *  'excerpt' => 'How about we re-imagine how to serve content from a CMS and leverage HTTP caching? How could it be done?',
 *  'title' => 'Thoughts about improving load resiliency for CMS driven Websites',
 *  'link' => 'https://renoirboulanger.com/blog/2015/08/thoughts-improving-load-resiliency-cms-driven-websites/',
 *  'pubDate' => 'Thu, 13 Aug 2015 02:39:48 +0000',
 *  'creator' => 'renoirb',
 *  'guid' => { isPermaLink: 'false', '$t': 'https://renoirboulanger.com/?p=6189' },
 *  'description' => {},
 *  'encoded' => 'How about we re-imagine how to serve content from a CMS and leverage HTTP caching? How could it be done?',
 *  'id' => '6189',
 *  'date' => '2015-08-12 22:39:48',
 *  'date_gmt' => '2015-08-13 02:39:48',
 *  'modified' => '2023-02-18 16:39:33',
 *  'modified_gmt' => '2023-02-18 21:39:33',
 *  'status' => 'publish',
 *  'ping_status' => 'open',
 *  'name' => 'thoughts-improving-load-resiliency-cms-driven-websites',
 *  'parent' => '0',
 *  'menu_order' => '0',
 *  'type' => 'post',
 *  'password' => {},
 *  'is_sticky' => '0',
 *  'category' => [
 *    {
 *      domain: 'category',
 *      nicename: 'programmation',
 *      '$t': 'Programmation'
 *    },
 *    { domain: 'post_tag', nicename: 'techniques', '$t': 'Techniques' }
 *  ],
 *  'postmeta' => Map(4) {
 *    '_edit_last' => '3',
 *    '_sd_is_markdown' => '1',
 *    '_pingme' => '1',
 *    '_encloseme' => '1'
 *  },
 *  'path' => '/blog/2015/08/thoughts-improving-load-resiliency-cms-driven-websites/'
 * }
 * ```
 *
 * See also:
 * - https://github.com/jonhoo/wp2ghost/blob/e25d81e8/lib/wp2ghost.js#L57-L159
 */
const reworkWpMap = (m) => {
  const map = new Map()
  if (Reflect.has(m, 'wp:post_type')) {
    map.set('postType', m['wp:post_type'])
  }
  if (Reflect.has(m, 'content:encoded')) {
    let data = ''
    const trying = m['content:encoded']
    if (typeof trying === 'string') {
      data = trying
    }
    map.set('content', data)
  }
  if (Reflect.has(m, 'excerpt:encoded')) {
    let data = ''
    const trying = m['excerpt:encoded']
    if (typeof trying === 'string') {
      data = trying
    }
    map.set('excerpt', data)
  }
  for (const [k, v] of Object.entries(m)) {
    let key = k
    let val = v
    if (/^wp\:/.test(k)) {
      key = normalizeKey(k)
    }
    if (/\:encoded/.test(k)) {
      key = k.split(':')[1]
    }

    key = key.replace(/^(dc\:|post_|meta_|comment_)/, '')
    if ('comment' === key) {
      const itemComments = []
      if (!Array.isArray(val)) {
        itemComments.push(reworkWpMap(val))
      } else {
        itemComments.push(...val.map((i) => reworkWpMap(i)))
      }
      val = itemComments
      // console.log(key, val)
    }
    if (/^(post|comment)meta$/.test(key) && Array.isArray(val)) {
      const meta = new Map()
      for (const p of val) {
        const d = reworkWpMap(p)
        let subVal = d.get('value')
        let subKey = d.get('key')
        if ('akismet_result' === subKey) {
          subVal = /true/i.test(subVal)
        }
        if ('social_raw_data' === subKey) {
          const decoded = atob(subVal)
          try {
            const d = JSON.parse(decoded)
            subVal = d
          } catch (e) {
            // Nothing
          }
        }
        if (PHP_STRING_SERIALIZED.includes(subKey)) {
          const decoded = phpUnserialize(subVal)
          subVal = decoded
          // console.log(subKey, decoded)
        }
        // if ('commentmeta' === key || 'postmeta' === key) {
        //   console.log(key, { subKey, subVal })
        // }
        meta.set(subKey, subVal)
      }
      val = meta
    }
    if ('commentmeta' === key) {
      key = key.replace(/^comment$/, '')
      // console.log({ key, val })
    }
    // if ('commentmeta' === key || 'postmeta' === key) {
    //   console.log(key, val)
    // }
    map.set(key, val)
  }
  return map
}

/**
 * @example of input
 *
 * ```
 * {
 *   title: 'Managing my PGP/OpenPGP keys and share across many machines',
 *   link: 'http://renoirboulanger.com/blog/2015/08/managing-pgp-private-keys-share-across-machines/',
 *   pubDate: 'Thu, 06 Aug 2015 17:44:11 +0000',
 *   'dc:creator': 'renoirb',
 *   description: {},
 *   'content:encoded':
 *   'excerpt:encoded': 'How about we re-imagine how to serve content from a CMS and leverage HTTP caching? How could it be done?',
 *   'wp:post_id': '6189',
 *   'wp:post_date': '2015-08-12 22:39:48',
 *   'wp:post_date_gmt': '2015-08-13 02:39:48',
 *   'wp:post_modified': '2023-02-18 16:39:33',
 *   'wp:post_modified_gmt': '2023-02-18 21:39:33',
 *   'wp:post_name': 'thoughts-improving-load-resiliency-cms-driven-websites',
 *   'wp:status': 'publish',
 *   'wp:post_parent': '0',
 *   'wp:post_type': 'post',
 *   'wp:is_sticky': '0'
 * }
 * ```
 */
const walk = (data) => {
  const json = parser.toJson(data)
  const obj = JSON.parse(json)
  channel = obj['rss']['channel']
  for (const _ci of channel['item']) {
    console.log('\n')
    const _rwm = reworkWpMap(_ci)
    // console.log(_ci)
    // console.log(_rwm)
    const title = _rwm.get('title')
    const status = _rwm.get('status')
    const link = _rwm.get('link')
    const postType = _rwm.get('postType')
    let pageSelector = 'publish'
    //pageSelector = 'private'
    // pageSelector = 'draft'
    let postSelector = 'publish'
    //postSelector = 'private'
    // postSelector = 'draft'
    // postSelector = 'trash'
    const path = normalizePaths(link)
    const pathNormalized = normalizePaths(dirnameNormalizer(link))
    _rwm.set('path', path)
    _rwm.set('pathNormalized', pathNormalized)
    const pathUnescaped = unescapeUrlPath(path)
    if (['page', 'post'].includes(postType) && /publish/.test(status)) {
      let needRedirect = (path === pathNormalized) === false
      const { to, ..._redirectMapItem } =
        REDICRECTS_MAP.get(pathNormalized) ?? {}
      if (needRedirect || to) {
        redirects.push({
          path,
          pathNormalized,
          pathUnescaped,
          to,
          ...(_redirectMapItem ?? {}),
        })
      }
    }
    if (
      ['page', 'post'].includes(postType) &&
      /publish/.test(status) === false
    ) {
      let pathToUse = path
      if (/^\/p\//.test(pathNormalized)) {
        pathToUse = pathNormalized
      }
      _rwm.set('path', '/unpublished' + pathToUse)
      unpublished.push(_rwm)
    }
    const _comments = _rwm.get('comment')
    const _commentsCount = _comments?.length ?? 0
    if (_commentsCount > 0 && /publish/.test(status)) {
      if (_comments) {
        _comments.map((_c, _idx) => {
          const date_gmt = _c.get('date_gmt') + ' GMT'
          const epoch = Date.parse(date_gmt)
          const _id = _c.get('id')
          const _parent = _rwm.get('link')
          const _reply_to_id = _c.get('parent')
          const message = toMarkdown(_c.get('content'))
          const fileName = 'comment-' + epoch + '.yaml'
          _c.set('path', '/comments' + path)
          _c.set('fileName', fileName)
          const name = _c.get('author')
          const author_email = _c.get('author_email')
          let email = ''
          if (typeof author_email === 'string') {
            email = md5(author_email ?? '')
          }
          console.debug(
            `Comment #${_id} made on ${date_gmt} (${epoch}) from page ${_parent}`,
            _c,
          )
          if (/renoirb/.test(author_email)) {
            console.log(`EMail hash for ${author_email} = ${email}`)
          }
          const commentData = {
            _id,
            _reply_to_id: _reply_to_id === '0' ? '' : _reply_to_id,
            _parent,
            date: epoch,
            name,
            email,
            message,
          }
          _c.set('forStaticman', commentData)
        })
      }
      comments.push(..._comments)
    }
    if (postType === 'attachment') {
      attachments.push(_rwm)
    }
    if (postType === 'page') {
      if (/publish/.test(status)) {
        pages.push(_rwm)
      }
    }
    if (postType === 'post') {
      if (/publish/.test(status)) {
        posts.push(_rwm)
      }
    }

    console.debug(`Walking ${count}`, {
      postType,
      title,
      commentsCount: _commentsCount,
      status: _rwm.get('status'),
      link: _rwm.get('link'),
      path: normalizePaths(_rwm.get('link')),
      pathNormalized: normalizePaths(dirnameNormalizer(_rwm.get('link'))),
    })
    if (['post', 'page'].includes(postType)) {
      if (!_rwm.get('path')) {
        const message = `Everything MUST have a path, please review how to make this item have a path`
        console.error(message, _rwm)
        throw new Error(message)
      }
    }

    count++
  }
}

const extractFromCategory = (p, domain) => {
  const output = []
  const list = p.get('category') // yup, tags and category in that
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item['domain'] === domain) {
        output.push(item['nicename'])
      }
    }
  }
  return output
}

const _devInspector = (p) => {
  const postType = p.get('postType')
  const commentData = p.get('comment')
  const title = p.get('title')
  const link = p.get('link')
  const path = p.get('path')
  const pathNormalized = p.get('pathNormalized')
  const status = p.get('status')
  const tags = extractFromCategory(p, 'post_tag')
  const categories = extractFromCategory(p, 'category')
  const content = p.get('content')
  const excerpt = p.get('excerpt')
  const date = p.get('date').split(' ')?.[0] ?? ''
  const modified = p.get('modified')?.split(' ')?.[0] ?? ''

  const commentsCount = commentData?.length ?? 0

  return {
    postType,
    status,
    title,
    link,
    date,
    modified,
    canonical: link,
    tags,
    categories,
    excerpt: typeof excerpt === 'string' ? excerpt?.substring(0, 100) : '',
    content: typeof content === 'string' ? content?.substring(0, 100) : '',
    commentsCount,
    path,
    pathNormalized,
  }
}

const processItem = (_p) => {
  let itemLocale
  const {
    canonical,
    commentsCount,
    date,
    modified,
    needRedirect,
    path,
    postType,
    status,
    title,
    link,
  } = _devInspector(_p)
  const fullPath = extractFullyQualifiedPath(_p)
  const fullPathLast = basename(fullPath)
  const fullPathParent = fullPath.replace(fullPathLast, '')
  if (!needRedirect) {
    const slug = pathName(canonical)
    const fileWithPrefixedPath = fullPath + '.md'

    const _shouldWriteFile = PATHS_I_DO_NOT_CARE.includes(path) === false

    console.table({
      postType,
      status,
      title,
      link,
      date,
      modified,
      commentsCount,
      shouldWriteFile: _shouldWriteFile,
      path,
      fileWithPrefixedPath: fileWithPrefixedPath.replace(
        PREFIX_TO_HIDE_IN_STDOUT,
        '~',
      ),
      slug,
      fullPathParent: fullPathParent.replace(PREFIX_TO_HIDE_IN_STDOUT, '~'),
    })

    if (_shouldWriteFile) {
      console.log(
        `Writing to ${fileWithPrefixedPath.replace(
          PREFIX_TO_HIDE_IN_STDOUT,
          '~',
        )}`,
      )
      mkdirSync(fullPathParent, { recursive: true })
      const [fm = {}, content] = createDocumentContents(_p)
      itemLocale = Reflect.get(fm, 'locale')
      const postmeta = _p.get('postmeta')
      /**
       * Examples:
       *
       * ```
       * Map(4) {
       *  '_edit_last' => '1',
       *  '_aktt_hash_meta' => {},
       *  'custom_retweet_text' => {},
       *  'aktt_notify_twitter' => 'yes'
       * }
       * ```
       *
       * ```
       * Map(11) {
       *  'keywords' => 'arnaque, piège, piéger, ursupation identité, identité personnelle, sécurité, méfiance, apprendre',
       *  '_wp_page_template' => 'default',
       *  'custom_retweet_text' => {},
       *  '_edit_last' => '3',
       *  '_aktt_hash_meta' => {},
       *  'aktt_notify_twitter' => 'yes',
       *  '_yoast_wpseo_linkdex' => '74',
       *  '_sd_is_markdown' => '1',
       *  '_yoast_wpseo_focuskw' => 'arnaque',
       *  '_yoast_wpseo_title' => 'Les pièges tendus sur Internet, comment les détecter',
       *  '_yoast_wpseo_metadesc' => "Premier d'une série d'articles servant a vulgariser certaines attrapes que l'on peut trouver sur le web."
       * }
       * ```
       */

      if (postmeta && 'get' in postmeta) {
        const metadesc = postmeta?.get('_yoast_wpseo_metadesc')
        if (metadesc) {
          const description = `${metadesc}`
          Reflect.set(fm, 'description', description)
        }
        // _yoast_wpseo_title
        const wpseo_title = postmeta?.get('_yoast_wpseo_title')
        if (wpseo_title) {
          Reflect.set(fm, 'title_alternate', wpseo_title)
        }
        // keywords
        const kw = postmeta?.get('keywords')
        if (kw) {
          const keywords = Reflect.has(fm, 'keywords')
            ? Reflect.get(fm, 'keywords')
            : []
          keywords.push(...kw.split(',').map((i) => i.trim()))
          Reflect.set(fm, 'keywords', keywords)
        }
      }
      let yml = ''
      try {
        const attempt = dump(fm)
        yml = attempt.trim()
      } catch (e) {
        console.error(`Unexpected error: ${e}`)
      }
      const document = ['---', yml, '---', '', content]
      writeFileSync(fileWithPrefixedPath, document.join('\n'), {
        encoding: 'utf8',
      })
      console.log(
        `Written to ${fileWithPrefixedPath.replace(
          PREFIX_TO_HIDE_IN_STDOUT,
          '~',
        )}\n`,
      )
    }
  }
  const line = [
    _p.get('link'),
    _p.get('id') ?? '',
    _p.get('title'),
    _p.get('status'),
    itemLocale,
  ].map(csvItemMapFn)
  exported_urls.push(line)
}

readFile('./wordpress.xml', (err, data) => {
  if (err) {
    console.error(err);
    return;
  }

  walk(data)

  console.log('\n\nPosts:')
  for (const p of posts) {
    processItem(p)
  }
  console.log(`Post total: ${posts.length}\n\n`)

  console.log('\n\nPages:')
  for (const p of pages) {
    processItem(p)
  }
  console.log(`Pages total: ${pages.length}\n\n`)

  console.log('\n\nComments:')
  for (const p of comments) {
    const fullPath = extractFullyQualifiedPath(p)
    const fileName = p.get('fileName')
    mkdirSync(fullPath, { recursive: true })
    let yml = ''
    try {
      const forStaticman = p.get('forStaticman')
      const attempt = dump(forStaticman)
      yml = attempt.trim()
    } catch (e) {
      console.error(`Unexpected error: ${e}`)
    }
    const fullPathToFile = fullPath + '/' + fileName
    writeFileSync(fullPathToFile, yml, {
      encoding: 'utf8',
    })
    console.log(
      `  Written to: ${fullPathToFile.replace(PREFIX_TO_HIDE_IN_STDOUT, '~')}`,
    )
  }
  console.log(`Comments total: ${comments.length}\n\n`)

  // xxx todo: attachment pages

  console.log('\n\nUnpublished:')
  for (const p of unpublished) {
    processItem(p)
  }
  console.log(`Unpublished total: ${pages.length}\n\n`)

  console.log('\n\nRedirects:')
  console.log(redirects)

  console.log('\n\nOddities:')
  console.log(oddities)

  console.log('\n\nAttachments:')
  const attachments_lines = []
  for (const a of attachments) {
    const attachment_url = a.get('attachment_url')
    const link = a.get('link')
    const excerpt = a.get('excerpt')
    const title = a.get('title')
    const content = a.get('content')
    const parentId = a.get('parent')
    console.log(`- ${link}`)
    const line = [parentId, link, attachment_url, excerpt, title, content]
      .map(csvItemMapFn)
      .join(';')
    attachments_lines.push(line)
  }
  const exportedAttachmentsCsvLines = [
    'Parent post_id;URL;attachmentURL;excerpt;title;content',
    ...attachments_lines,
  ].join('\n')
  writeFileSync('out_exported_attachments.csv', exportedAttachmentsCsvLines, {
    encoding: 'utf8',
  })

  console.log('\n\nExported URLs:')
  for (const [link] of exported_urls.sort(sortExportedUrls)) {
    console.log(`- ${link}`)
  }
  const exportedCsvLines = [
    'URL;post_id;title;status;locale',
    ...exported_urls.map((i) => i.join(';')),
  ].join('\n')
  writeFileSync('out_exported.csv', exportedCsvLines, {
    encoding: 'utf8',
  })
})
