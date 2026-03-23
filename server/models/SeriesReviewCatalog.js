const { DataTypes, Model } = require('sequelize')

class SeriesReviewCatalog extends Model {
  /**
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        seriesName: {
          type: DataTypes.STRING,
          allowNull: false
        },
        seriesNameNormalized: {
          type: DataTypes.STRING,
          allowNull: false
        },
        trustStatus: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'trusted'
        },
        visibilityStatus: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'visible'
        },
        dismissedAt: {
          type: DataTypes.DATE,
          allowNull: true
        },
        entries: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        },
        selectionBySlot: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: {}
        }
      },
      {
        sequelize,
        modelName: 'seriesReviewCatalog',
        indexes: [
          {
            fields: ['libraryId', 'trustStatus']
          },
          {
            name: 'seriesReviewCatalog_library_series_key',
            unique: true,
            fields: ['libraryId', 'seriesNameNormalized']
          }
        ]
      }
    )

    const { library } = sequelize.models

    library.hasMany(SeriesReviewCatalog, {
      foreignKey: 'libraryId',
      as: 'seriesReviewCatalogs',
      onDelete: 'CASCADE'
    })
    SeriesReviewCatalog.belongsTo(library, {
      foreignKey: 'libraryId',
      as: 'library',
      onDelete: 'CASCADE'
    })
  }
}

module.exports = SeriesReviewCatalog
