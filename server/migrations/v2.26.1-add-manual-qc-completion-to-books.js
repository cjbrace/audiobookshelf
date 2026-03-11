/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface
 * @property {import('../Logger')} logger
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context
 */

const migrationVersion = '2.26.1'
const migrationName = `${migrationVersion}-add-manual-qc-completion-to-books`
const loggerPrefix = `[${migrationVersion} migration]`

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  const tableDescription = await queryInterface.describeTable('books')
  if (tableDescription.manualQcCompleted) {
    logger.info(`${loggerPrefix} column "manualQcCompleted" already exists`)
    logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
    return
  }

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
  await queryInterface.addColumn('books', 'manualQcCompleted', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  })
  // Explicit backfill policy for Task 23:
  // do not derive manual QC from playback/media progress; existing rows start unticked.
  await queryInterface.sequelize.query('UPDATE books SET manualQcCompleted = 0')

  logger.info(`${loggerPrefix} added column "manualQcCompleted" to "books"`)
  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  const tableDescription = await queryInterface.describeTable('books')
  if (!tableDescription.manualQcCompleted) {
    logger.info(`${loggerPrefix} column "manualQcCompleted" does not exist`)
    logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
    return
  }

  await queryInterface.removeColumn('books', 'manualQcCompleted')
  logger.info(`${loggerPrefix} removed column "manualQcCompleted" from "books"`)
  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
