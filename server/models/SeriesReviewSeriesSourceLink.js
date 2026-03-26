const { DataTypes, Model } = require('sequelize')

class SeriesReviewSeriesSourceLink extends Model {
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
          allowNull: true
        }
      },
      {
        sequelize,
        modelName: 'seriesReviewSeriesSourceLink',
        indexes: [
          {
            name: 'seriesReviewSeriesSourceLink_library_local_decision_key_source_series_url',
            unique: true,
            fields: ['libraryId', 'localDecisionKey', 'sourceSeriesUrl']
          },
          {
            fields: ['libraryId', 'sourceSeriesUrl']
          },
          {
            fields: ['libraryId', 'isActive']
          }
        ]
      }
    )

    const { library, user } = sequelize.models

    library.hasMany(SeriesReviewSeriesSourceLink, {
      foreignKey: 'libraryId',
      as: 'seriesReviewSeriesSourceLinks',
      onDelete: 'CASCADE'
    })
    SeriesReviewSeriesSourceLink.belongsTo(library, {
      foreignKey: 'libraryId',
      as: 'library',
      onDelete: 'CASCADE'
    })

    if (user) {
      SeriesReviewSeriesSourceLink.belongsTo(user, {
        foreignKey: 'unlinkedByUserId',
        as: 'unlinkedByUser',
        onDelete: 'SET NULL'
      })
    }
  }
}

module.exports = SeriesReviewSeriesSourceLink
