require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

const app = express();

// Настройки подключения к MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pzk_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Настройки для отправки в Битрикс
const BITRIX_CONFIG = {
    webhookUrl: process.env.BITRIX_WEBHOOK_URL,
    // Альтернативный вариант - через REST API с логином и паролем
    // domain: process.env.BITRIX_DOMAIN || 'your-bitrix-domain.bitrix24.ru',
    // userId: process.env.BITRIX_USER_ID || '',
    // secret: process.env.BITRIX_SECRET || ''
};

// Создаем pool соединений с MySQL
const pool = mysql.createPool(dbConfig);

app.use(bodyParser.json());
app.use(cors());

// Функция для создания таблицы, если её нет
async function createTableIfNotExists() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                bitrix_sent BOOLEAN DEFAULT FALSE,
                bitrix_response TEXT
            )
        `);
        connection.release();
        console.log('Таблица leads проверена/создана');
    } catch (error) {
        console.error('Ошибка при создании таблицы:', error);
    }
}

// Функция для отправки данных в Битрикс
async function sendToBitrix(name, phone) {
    try {
        const response = await fetch(BITRIX_CONFIG.webhookUrl + 'crm.lead.add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fields: {
                    TITLE: `Заявка от ${name}`,
                    NAME: name,
                    PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
                    SOURCE_ID: 'WEB',
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error_description || 'Ошибка при отправке в Битрикс');
        }

        return {
            success: true,
            result: data.result,
            leadId: data.result
        };
    } catch (error) {
        console.error('Ошибка при отправке в Битрикс:', error);
        throw error;
    }
}

// Эндпоинт для создания заявки
app.post('/createlead', async function (request, response) {
    try {
        const { name, phone } = request.body;

        // Валидация данных
        if (!name || !phone) {
            return response.status(400).json({
                success: false,
                message: 'Имя и телефон обязательны для заполнения'
            });
        }

        // Проверка формата телефона (базовая валидация)
        const phoneRegex = /^[\d\s\-\+\(\)]+$/;
        if (!phoneRegex.test(phone)) {
            return response.status(400).json({
                success: false,
                message: 'Неверный формат телефона'
            });
        }

        // Записываем в БД
        let dbResult;
        try {
            const connection = await pool.getConnection();
            const [result] = await connection.query(
                'INSERT INTO leads (name, phone) VALUES (?, ?)',
                [name, phone]
            );
            dbResult = result;
            connection.release();
            console.log('Данные записаны в БД, ID:', result.insertId);
        } catch (dbError) {
            console.error('Ошибка при записи в БД:', dbError);
            return response.status(500).json({
                success: false,
                message: 'Ошибка при сохранении заявки в базу данных'
            });
        }

        // Отправляем в Битрикс
        let bitrixResponse = null;
        try {
            bitrixResponse = await sendToBitrix(name, phone);
            console.log('Данные отправлены в Битрикс, Lead ID:', bitrixResponse.leadId);

            // Обновляем запись в БД о том, что данные отправлены в Битрикс
            const connection = await pool.getConnection();
            await connection.query(
                'UPDATE leads SET bitrix_sent = ?, bitrix_response = ? WHERE id = ?',
                [true, JSON.stringify(bitrixResponse), dbResult.insertId]
            );
            connection.release();
        } catch (bitrixError) {
            console.error('Ошибка при отправке в Битрикс:', bitrixError);
            // Обновляем запись в БД о том, что произошла ошибка
            const connection = await pool.getConnection();
            await connection.query(
                'UPDATE leads SET bitrix_response = ? WHERE id = ?',
                [JSON.stringify({ error: bitrixError.message }), dbResult.insertId]
            );
            connection.release();

            // Все равно возвращаем успех пользователю, так как данные сохранены в БД
            // Если нужно возвращать ошибку, раскомментируйте следующие строки:
            // return response.status(500).json({
            //     success: false,
            //     message: 'Заявка сохранена, но не отправлена в Битрикс'
            // });
        }

        // Отправляем ответ пользователю
        response.json({
            success: true,
            message: 'Заявка успешно отправлена',
            data: {
                id: dbResult.insertId,
                name: name,
                phone: phone,
                bitrixLeadId: bitrixResponse?.leadId || null
            }
        });

    } catch (error) {
        console.error('Общая ошибка при обработке заявки:', error);
        response.status(500).json({
            success: false,
            message: 'Произошла ошибка при обработке заявки'
        });
    }
});

// Эндпоинт для проверки здоровья сервера
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Инициализация таблицы и запуск сервера
createTableIfNotExists().then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
        console.log('Эндпоинт для создания заявки: POST /createlead');
        console.log('Эндпоинт для проверки: GET /health');
    });
}).catch(error => {
    console.error('Ошибка при инициализации:', error);
    process.exit(1);
});