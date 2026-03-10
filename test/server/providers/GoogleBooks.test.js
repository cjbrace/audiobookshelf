const { expect } = require('chai')
const GoogleBooks = require('../../../server/providers/GoogleBooks')

describe('GoogleBooks', () => {
  let googleBooks

  beforeEach(() => {
    googleBooks = new GoogleBooks()
  })

  describe('cleanResult', () => {
    it('maps publishedDate to publishedYear and includes language', () => {
      const result = googleBooks.cleanResult({
        id: 'vol-1',
        volumeInfo: {
          title: 'Guards! Guards!',
          subtitle: '(Discworld Novel 8)',
          authors: ['Terry Pratchett'],
          publisher: 'Random House',
          publishedDate: '2008-12-16',
          language: 'en',
          description: 'desc',
          categories: ['Fiction', 'Fantasy'],
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781407034690' }]
        }
      })

      expect(result).to.include({
        id: 'vol-1',
        title: 'Guards! Guards!',
        subtitle: '(Discworld Novel 8)',
        author: 'Terry Pratchett',
        publisher: 'Random House',
        publishedYear: '2008',
        language: 'en',
        description: 'desc',
        isbn: '9781407034690'
      })
      expect(result.genres).to.deep.equal(['Fiction', 'Fantasy'])
    })

    it('extracts series and sequence from subtitle pattern', () => {
      const result = googleBooks.cleanResult({
        id: 'vol-2',
        volumeInfo: {
          title: 'Mort',
          subtitle: '(Discworld Novel 4)'
        }
      })

      expect(result.series).to.deep.equal([{ series: 'Discworld', sequence: '4' }])
    })

    it('does not create series when subtitle has no sequence pattern', () => {
      const result = googleBooks.cleanResult({
        id: 'vol-3',
        volumeInfo: {
          title: 'The Two Towers',
          subtitle: 'Being the Second Part of The Lord of the Rings'
        }
      })

      expect(result.series).to.equal(null)
    })
  })
})
