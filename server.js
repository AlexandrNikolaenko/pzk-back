require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const multer = require('multer');
const fs = require('fs');
const { clearInterval } = require('timers');

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
// app.use('/img/ready', express.static('./img/ready'));
app.use('/img/upload', express.static('./img/upload'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './img/upload');
  },
  filename: (req, file, cb) => {
    console.log(req.body);
    cb(null, req.body.imageId + '.jpg'); // Сохранение файла с оригинальным именем
  }
})

const upload = multer({ storage: storage });

// Функция для создания таблицы, если её нет
async function createTableIfNotExists() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                from VARCHAR(255) NOT NULL,
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
async function sendToBitrix(name, phone, comment) {
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
                    COMMENT: 'from: ' + comment
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

async function nanoBananaQuery(body) {
  try {
    const res = await fetch('https://api.nanobananaapi.ai/api/v1/nanobanana/generate', {
      method: "POST",
      headers: {
        Authorization: 'Bearer ' + process.env.NANABANANA_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    } else throw await res.json();
  } catch (e) {
    console.log(e);
    return;
  }
}

async function nanoBananaCheckQuery(taskId) {
  try {
    const res = await fetch('https://api.nanobananaapi.ai/api/v1/nanobanana/record-info?taskId=' + taskId, {
      method: "GET",
      headers: {
        Authorization: 'Bearer ' + process.env.NANABANANA_TOKEN,
      }
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    } else throw await res.json();
  } catch (e) {
    console.log(e);
    return;
  }
}

app.post('/generate', upload.single('file'), async function (request, response) {
    response.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": '*',
    });
    
    try {
        const res = await nanoBananaQuery({
            prompt: `Professional architectural nighttime visualization of any residential/commercial building exterior with premium LED facade illumination. No snow unless present in the input image.​
            Objective
            Produce continuous warm LED contour lighting along primary upper edges of the building massing: rooflines, eaves, gables, cornices, parapets, horizontal ledges, and facade returns across all floors, including porches, verandas, bay windows, annexes, dormers, and mansard roof breaks.​
            Additionally, overlay these primary contour lines with a high-quality 'icicle' fringe (бахрома) garland. This fringe must appear to hang naturally downwards from the main LED strips, sharing their placement along all specified upper edges (rooflines, eaves, gables, etc.).
            Strictly exclude base/ground‑adjacent lighting: do not place LEDs along the plinth/socle, grade line, stair treads, terrace edges at ground level, or any bottom skirting.​
            Geometry handling (universal)
            Detect and follow edges procedurally: if an edge separates exterior planes or forms a silhouette above the plinth level, apply a linear LED run unless that edge is a window/door frame.​
            For complex roofs (hip, mansard, flat with parapet, multi‑gable), trace each continuous ridge, eave, and parapet cap; for mansards specifically, trace the upper break line and the lower steep-slope eave while skipping window frames of dormers; bridge short discontinuities at intersections for visual continuity.​
            For porches/verandas/loggias/canopies, bay volumes, dormers, and annexes, wrap LEDs along their upper and mid‑level architectural bands and eaves; skip any edges that sit at floor/ground level.​
            Mansards and annexes
            Mansard roofs: outline the entire perimeter along the top ridge/parapet and along the transition (break) between shallow upper slope and steep lower slope; continue along eaves of the lower slope where not at ground level. Avoid outlining individual dormer window frames.​
            Dormers: run LEDs along dormer roof eaves and dormer cheek returns only if these are architectural edges, not window frames; merge back into the main roofline without brightness doubling.​
            Annexes and attached volumes: treat as primary massing; close the LED loop on all visible upper edges and eaves of each annex above plinth level.​
            Lighting style
            Main contour lighting and icicle fringe: 3000–4000K warm white, high CRI; welcoming golden tint. The fringe elements (drops) must match the main strip's color and premium quality, avoiding a "cheap" festive look.
    Global brightness ≈ 67% of a bright reference; hierarchy: rooflines and main entry brightest; vertical corner grazers secondary; wall grazing minimal.​
    Optics: tight, glare‑controlled edge grazing; soft vertical grazing at facade corners only; suppress spill, lens flare, and glass reflections.​
    Implementation rules
    No lighting of window/door frames unless already present in the input; skip mullions and glazing.​
    Fixtures: IP67 linear exterior LED and compact wall grazers; concealed mounting and wiring; no visible cables or brackets.​
    Realistic energy envelope for a single facade: total 0.3–1.5 kW, scaled to frontage and run length.​
    Scene and materials
    Night setting with dark ambient; match season/landscape to input; no added snow unless visible.​
    Preserve original architecture, proportions, and materials; photorealistic reflections and shadowing; physically plausible exposure without clipped highlights.​
    Camera and render
    Professional architectural framing with minimal distortion; tripod‑stable exposure.​
    Photorealistic 8K quality; correct falloff and continuous luminance across joints and corners.​
    Quality safeguards
    Close the LED loop on all visible roofline/eave/cornice runs and attached upper volumes (including mansards, dormers, and annexes) so no eligible edge remains unlit; leave all ground‑adjacent edges unlit.​
    Merge overlapping runs at corners; avoid double brightness and light trespass to sky or neighbors.​
    Exclusions
    No neon, saturated colors, or other forms of added decor. The specified warm white 'icicle' fringe (бахрома) integrated with the contour lighting is the ONLY exception.
    No driveway, garden, fence, landscape, or ground‑level/skirting/step lighting.​
    Negative prompts
    Under‑lit rooflines, broken contour at eaves, base/ground strip lighting, window‑frame outlining, visible wiring, plastic‑like materials, oversaturation, distorted geometry`,
            type: "TEXTTOIAMGE",
            callBackUrl: "https://spb.pzkgroup.ru/api/callbackimage",
            imageUrls: ['https://spb.pzkgroup.ru/api/img/upload/' + request.body.imageId + '.jpg']
        });

        setTimeout(() => {
            fs.unlink('./img/upload/' + request.body.imageId + '.jpg', (err) => {
                if (err) throw err;
                console.log('Файл успешно удален');
            });
        }, 1000 * 60 * 2);
    
    
        const interval = setInterval(() => {
            nanoBananaCheckQuery(res.data.taskId).then(result => {
                console.log(result);
                if (result.data.successFlag == 1) {
                    response.json({image: result.data.response.resultImageUrl});
                    clearInterval(interval);
                }
            }).catch(e => {
                clearInterval(interval);
                throw new Error(e);
            })
        }, 5000)
    } catch(e) {
        console.error(e);
        response.status(500).send();
    }
})

// Эндпоинт на получение уведомления об изображении
app.post('/callbackimage', async function (request, response) {
    console.log(request.body);
    response.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": '*',
    }).send();
})

// Эндпоинт для создания заявки
app.post('/createlead', async function (request, response) {
    response.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": '*',
    });
    try {
        const { name, phone, path } = request.body;

        // Валидация данных
        if (!name || !phone) {
            return response.status(400).json({
                success: false,
                message: 'Имя и телефон обязательны для заполнения',
                fields: {
                  name: !name,
                  phone: !phone
                } 
            });
        }

        // Проверка формата телефона (базовая валидация)
        const phoneRegex = /^[\d\s\-\+\(\)]+$/;
        if (!phoneRegex.test(phone)) {
            return response.status(400).json({
                success: false,
                message: 'Неверный формат телефона',
                fields: {
                  name: false,
                  phone: true
                }
            });
        }

        // Записываем в БД
        let dbResult;
        try {
            const connection = await pool.getConnection();
            const [result] = await connection.query(
                'INSERT INTO leads (name, phone, from) VALUES (?, ?, ?)',
                [name, phone, path]
            );
            dbResult = result;
            connection.release();
            console.log('Данные записаны в БД, ID:', result.insertId);
        } catch (dbError) {
            console.error('Ошибка при записи в БД:', dbError);
        }

        // Отправляем в Битрикс
        let bitrixResponse = null;
        try {
            bitrixResponse = await sendToBitrix(name, phone, path);
            console.log('Данные отправлены в Битрикс, Lead ID:', bitrixResponse.leadId);

            // Обновляем запись в БД о том, что данные отправлены в Битрикс
            try {
              const connection = await pool.getConnection();
              await connection.query(
                  'UPDATE leads SET bitrix_sent = ?, bitrix_response = ? WHERE id = ?',
                  [true, JSON.stringify(bitrixResponse), dbResult.insertId]
              );
              connection.release();
            } catch (e) {
              console.log('Ошибка при обновлении бд: ', e);
            }
        } catch (bitrixError) {
            console.error('Ошибка при отправке в Битрикс:', bitrixError);
            // Обновляем запись в БД о том, что произошла ошибка
            try {
              const connection = await pool.getConnection();
              await connection.query(
                  'UPDATE leads SET bitrix_response = ? WHERE id = ?',
                  [JSON.stringify({ error: bitrixError.message }), dbResult.insertId]
              );
              connection.release();
            } catch (e) {
              console.log('Ошибка при обновлении бд: ', e);
            }
        }

        // Отправляем ответ пользователю
        response.json({
            success: true,
            message: 'Заявка успешно отправлена',
            data: {
                name: name,
                phone: phone,
                bitrixLeadId: bitrixResponse?.leadId || null
            }
        });

    } catch (error) {
        console.error('Общая ошибка при обработке заявки:', error);
        response.status(500).json({
            success: false,
            message: 'Произошла ошибка при обработке заявки',
            fields: {
              name: false,
              phone: false
            }
        });
    }
});

// Эндпоинт для проверки здоровья сервера
app.get('/health', (req, res) => {
    response.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": '*',
    });
    res.json({ status: 'ok' });
});

// Инициализация таблицы и запуск сервера
createTableIfNotExists().catch(error => {
    console.error('Ошибка при инициализации:', error);
    process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log('Эндпоинт для создания заявки: POST /createlead');
    console.log('Эндпоинт для проверки: GET /health');
});