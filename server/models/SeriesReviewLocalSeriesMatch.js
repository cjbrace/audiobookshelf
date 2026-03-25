const { DataTypes, Model } = require('sequelize')

class SeriesReviewLocalSeriesMatch extends Model {
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
        evidenceSnapshot: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: {}
        }
      },
      {
        sequelize,
        modelName: 'seriesReviewLocalSeriesMatch',
        indexes: [
          {
            name: 'seriesReviewLocalSeriesMatch_library_local_decision_key',
            unique: true,
            fields: ['libraryId', 'localDecisionKey']
          },
          {
            fields: ['libraryId', 'sourceSeriesUrl']
          }
        ]
      }
    )

    const { library } = sequelize.models

    library.hasMany(SeriesReviewLocalSeriesMatch, {
      foreignKey: 'libraryId',
      as: 'seriesReviewLocalSeriesMatches',
      onDelete: 'CASCADE'
    })
    SeriesReviewLocalSeriesMatch.belongsTo(library, {
      foreignKey: 'libraryId',
      as: 'library',
      onDelete: 'CASCADE'
    })
  }
}

module.exports = SeriesReviewLocalSeriesMatch
