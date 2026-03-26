/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface
 * @property {import('../Logger')} logger
 */

const migrationVersion = '2.32.2'
const migrationName = `${migrationVersion}-add-series-review-series-source-links`
const loggerPrefix = `[${migrationVersion} migration]`

function getMatchingBooksCount(evidenceSnapshot) {
  const matchingBooks = Array.isArray(evidenceSnapshot?.matchingBooks) ? evidenceSnapshot.matchingBooks : []
  return matchingBooks.filter((book) => book && typeof book === 'object').length
}

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  const tables = await queryInterface.showAllTables()
  if (!tables.includes('seriesReviewSeriesSourceLinks')) {
    const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
    await queryInterface.createTable('seriesReviewSeriesSourceLinks', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4
      },
      libraryId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'libraries',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      localDecisionKey: {
        type: DataTypes.STRING,
        allowNull: false
      },
      localSeriesName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      source: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'fictiondb'
      },
      sourceSeriesName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      sourceAuthor: {
        type: DataTypes.STRING,
        allowNull: true
      },
      sourceSeriesUrl: {
        type: DataTypes.STRING,
        allowNull: false
      },
      coverageStatus: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'partial'
      },
      linkedBookCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      totalBookCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      evidenceSnapshot: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {}
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      unlinkedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      unlinkedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    })

    await queryInterface.addIndex('seriesReviewSeriesSourceLinks', ['libraryId', 'localDecisionKey', 'sourceSeriesUrl'], {
      unique: true,
      name: 'seriesReviewSeriesSourceLink_library_local_decision_key_source_series_url'
    })
    await queryInterface.addIndex('seriesReviewSeriesSourceLinks', ['libraryId', 'sourceSeriesUrl'], {
      name: 'seriesReviewSeriesSourceLink_library_source_series_url'
    })
    await queryInterface.addIndex('seriesReviewSeriesSourceLinks', ['libraryId', 'isActive'], {
      name: 'seriesReviewSeriesSourceLink_library_is_active'
    })
  }

  const rows = await queryInterface.sequelize.query(
    'SELECT id, libraryId, localDecisionKey, localSeriesName, source, sourceSeriesName, sourceAuthor, sourceSeriesUrl, evidenceSnapshot, createdAt, updatedAt FROM seriesReviewLocalSeriesMatches',
    { type: queryInterface.sequelize.QueryTypes.SELECT }
  )
  if (Array.isArray(rows) && rows.length) {
    const now = new Date().toISOString()
    for (const row of rows) {
      const evidenceSnapshot = row.evidenceSnapshot && typeof row.evidenceSnapshot === 'object' && !Array.isArray(row.evidenceSnapshot) ? row.evidenceSnapshot : {}
      const linkedBookCount = getMatchingBooksCount(evidenceSnapshot)
      const coverageStatus = linkedBookCount > 0 ? 'linked' : 'partial'
      await queryInterface.sequelize.query(
        `INSERT OR IGNORE INTO seriesReviewSeriesSourceLinks
          (id, libraryId, localDecisionKey, localSeriesName, source, sourceSeriesName, sourceAuthor, sourceSeriesUrl, coverageStatus, linkedBookCount, totalBookCount, evidenceSnapshot, isActive, unlinkedAt, unlinkedByUserId, createdAt, updatedAt)
         VALUES
          (:id, :libraryId, :localDecisionKey, :localSeriesName, :source, :sourceSeriesName, :sourceAuthor, :sourceSeriesUrl, :coverageStatus, :linkedBookCount, :totalBookCount, :evidenceSnapshot, 1, NULL, NULL, :createdAt, :updatedAt)`,
        {
          replacements: {
            id: row.id,
            libraryId: row.libraryId,
            localDecisionKey: row.localDecisionKey,
            localSeriesName: row.localSeriesName,
            source: row.source,
            sourceSeriesName: row.sourceSeriesName,
            sourceAuthor: row.sourceAuthor,
            sourceSeriesUrl: row.sourceSeriesUrl,
            coverageStatus,
            linkedBookCount,
            totalBookCount: linkedBookCount,
            evidenceSnapshot: JSON.stringify(evidenceSnapshot || {}),
            createdAt: row.createdAt || now,
            updatedAt: row.updatedAt || now
          }
        }
      )
    }
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  const tables = await queryInterface.showAllTables()
  if (!tables.includes('seriesReviewSeriesSourceLinks')) {
    logger.info(`${loggerPrefix} table "seriesReviewSeriesSourceLinks" does not exist`)
    logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
    return
  }

  await queryInterface.dropTable('seriesReviewSeriesSourceLinks')

  logger.info(`${loggerPrefix} dropped table "seriesReviewSeriesSourceLinks"`)
  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
