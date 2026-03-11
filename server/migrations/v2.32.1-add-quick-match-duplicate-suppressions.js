/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface
 * @property {import('../Logger')} logger
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context
 */

const migrationVersion = '2.32.1'
const migrationName = `${migrationVersion}-add-quick-match-duplicate-suppressions`
const loggerPrefix = `[${migrationVersion} migration]`

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  const tables = await queryInterface.showAllTables()
  if (tables.includes('quickMatchDuplicateSuppressions')) {
    logger.info(`${loggerPrefix} table "quickMatchDuplicateSuppressions" already exists`)
    logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
    return
  }

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
  await queryInterface.createTable('quickMatchDuplicateSuppressions', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'quickMatchSessions',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    },
    createdByUserId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    },
    groupKey: {
      type: DataTypes.STRING,
      allowNull: false
    },
    groupFingerprint: {
      type: DataTypes.TEXT,
      allowNull: false
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

  await queryInterface.addIndex('quickMatchDuplicateSuppressions', ['sessionId', 'groupKey'], {
    unique: true,
    name: 'quick_match_duplicate_suppressions_session_group_unique'
  })
  await queryInterface.addIndex('quickMatchDuplicateSuppressions', ['sessionId'], {
    name: 'quick_match_duplicate_suppressions_session_idx'
  })

  logger.info(`${loggerPrefix} created table "quickMatchDuplicateSuppressions"`)
  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  const tables = await queryInterface.showAllTables()
  if (!tables.includes('quickMatchDuplicateSuppressions')) {
    logger.info(`${loggerPrefix} table "quickMatchDuplicateSuppressions" does not exist`)
    logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
    return
  }

  await queryInterface.dropTable('quickMatchDuplicateSuppressions')

  logger.info(`${loggerPrefix} dropped table "quickMatchDuplicateSuppressions"`)
  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
