import "dotenv/config";
import { Sequelize } from 'sequelize';
const { PROJECT_NAME } = process.env;

const {
    DB_CONNECTION,
    DB_HOST,
    DB_DATABASE,
    DB_USERNAME,
    DB_PASSWORD,
} = process.env;

const sequelize = new Sequelize(DB_DATABASE!, DB_USERNAME!, DB_PASSWORD!, {
    host: DB_HOST,
    dialect: DB_CONNECTION as never,
    define: {
        freezeTableName: true,
    },
    // benchmark: true,
    logging: false,
    pool: {
        max: 250, // Maximum number of connections in the pool
        min: 0, // Minimum number of connections in the pool
        idle: 10000, // The maximum time, in milliseconds, that a connection can be idle before being released
        acquire: 600000, // Increase this value to increase the timeout (in milliseconds)
    },
});

const connectDb = async (): Promise<void> => {
    try {
        await sequelize.authenticate();
        console.log(
            `• Database connection has been established successfully on DB host: ${DB_HOST}`
        );
        await sequelize.sync()
        console.log(`• ${PROJECT_NAME} models synchronized successfully`);
    } catch (error) {
        console.error(`Unable to connect to the ${PROJECT_NAME} database: `, error);
        process.exit(1);
    }
};


export { connectDb, sequelize };
