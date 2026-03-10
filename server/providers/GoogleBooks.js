const axios = require('axios')
const Logger = require('../Logger')

class GoogleBooks {
  #responseTimeout = 10000

  constructor() {}

  parsePublishedYear(publishedDate) {
    if (!publishedDate || typeof publishedDate !== 'string') return null
    const match = publishedDate.match(/^(\d{4})/)
    return match ? match[1] : null
  }

  extractSeriesFromSubtitle(subtitle) {
    if (!subtitle || typeof subtitle !== 'string') return null
    const normalized = subtitle.trim()
    if (!normalized) return null

    const patterns = [
      /^\((.+?)\s+(?:novel|book)\s+(\d+(?:\.\d+)?)\)$/i,
      /^(.+?)\s+#\s*(\d+(?:\.\d+)?)$/i,
      /^(.+?),?\s+book\s+(\d+(?:\.\d+)?)$/i,
      /^book\s+(\d+(?:\.\d+)?)\s+of\s+(.+)$/i
    ]

    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (!match) continue

      const seriesName = pattern === patterns[3] ? match[2] : match[1]
      const sequence = pattern === patterns[3] ? match[1] : match[2]
      const cleanSeries = String(seriesName || '').trim()
      if (!cleanSeries || !sequence) return null

      return [
        {
          series: cleanSeries,
          sequence: String(sequence)
        }
      ]
    }

    return null
  }

  extractIsbn(industryIdentifiers) {
    if (!industryIdentifiers || !industryIdentifiers.length) return null

    var isbnObj = industryIdentifiers.find((i) => i.type === 'ISBN_13') || industryIdentifiers.find((i) => i.type === 'ISBN_10')
    if (isbnObj && isbnObj.identifier) return isbnObj.identifier
    return null
  }

  cleanResult(item) {
    var { id, volumeInfo } = item
    if (!volumeInfo) return null
    const { title, subtitle, authors, publisher, publishedDate, description, industryIdentifiers, categories, imageLinks, language } = volumeInfo

    let cover = null
    // Selects the largest cover assuming the largest is the last key in the object
    if (imageLinks && Object.keys(imageLinks).length) {
      cover = imageLinks[Object.keys(imageLinks).pop()]
      cover = cover?.replace(/^http:/, 'https:') || null
    }

    const series = this.extractSeriesFromSubtitle(subtitle)

    return {
      id,
      title,
      subtitle: subtitle || null,
      author: authors ? authors.join(', ') : null,
      publisher,
      publishedYear: this.parsePublishedYear(publishedDate),
      description,
      cover,
      language: language || null,
      series,
      genres: categories && Array.isArray(categories) ? [...categories] : null,
      isbn: this.extractIsbn(industryIdentifiers)
    }
  }

  /**
   * Search for a book by title and author
   * @param {string} title
   * @param {string} author
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object[]>}
   **/
  async search(title, author, timeout = this.#responseTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    title = encodeURIComponent(title)
    let queryString = `q=intitle:${title}`
    if (author) {
      author = encodeURIComponent(author)
      queryString += `+inauthor:${author}`
    }
    const url = `https://www.googleapis.com/books/v1/volumes?${queryString}`
    Logger.debug(`[GoogleBooks] Search url: ${url}`)
    const items = await axios
      .get(url, {
        timeout
      })
      .then((res) => {
        if (!res || !res.data || !res.data.items) return []
        return res.data.items
      })
      .catch((error) => {
        Logger.error('[GoogleBooks] Volume search error', error.message)
        return []
      })
    return items.map((item) => this.cleanResult(item))
  }
}

module.exports = GoogleBooks
