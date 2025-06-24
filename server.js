const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const port = 1181;

// 添加 CORS 支持
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.static('public'));

// 添加调试日志中间件
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

const dataFilePath = path.join(__dirname, 'structured_data.json');

// 存储数据
function storeData(data, currentTime) {
    const year = currentTime.getFullYear().toString();
    const month = (currentTime.getMonth() + 1).toString().padStart(2, '0');
    const day = currentTime.getDate().toString().padStart(2, '0');
    const time = currentTime.toTimeString().slice(0, 5).replace(/:/, '-');

    const dirPath = path.join(__dirname, 'data', year, month, day);

    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        const filePath = path.join(dirPath, `${time}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log('Data stored successfully:', filePath);
    } catch (error) {
        console.error('Failed to store data:', error);
    }
}

function storeDataAsEndOfDay(pluginData, previousDayTime) {
    const year = previousDayTime.getFullYear().toString();
    const month = (previousDayTime.getMonth() + 1).toString().padStart(2, '0');
    const day = previousDayTime.getDate().toString().padStart(2, '0');

    const dirPath = path.join(__dirname, 'data', year, month, day);
    const filePath = path.join(dirPath, `24-00.json`);

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(pluginData, null, 2));
}

function findPreviousData(currentTime) {
    const previousDay = new Date(currentTime.getTime() - 86400000);

    const year = previousDay.getFullYear().toString();
    const month = (previousDay.getMonth() + 1).toString().padStart(2, '0');
    const day = previousDay.getDate().toString().padStart(2, '0');

    const dirPath = path.join(__dirname, 'data', year, month, day);
    if (!fs.existsSync(dirPath)) {
        console.log(`No data directory found for ${year}-${month}-${day}.`);
        return null;
    }

    const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
        console.log(`No data files found for ${year}-${month}-${day}.`);
        return null;
    }

    const lastFile = files.sort().pop();
    const filePath = path.join(dirPath, lastFile);
    const previousData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    return previousData;
}

app.listen(1181, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('Available endpoints:');
    console.log('- GET /test');
    console.log('- GET /fetch-plugin-data');
    console.log('- GET /get-data');
    console.log('- GET /get-directory');
});

function startFetchTask() {
    const now = new Date();
    const millisTillNextHalfHour = 1800000 - (now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds()) % 1800000;

    setTimeout(async () => {
        await fetchData();
        setInterval(async () => {
            await fetchData();
        }, 1800000);
    }, millisTillNextHalfHour);
}

startFetchTask();

async function fetchData() {
    try {
        const now = new Date();
        const isMidnight = now.getHours() === 0 && now.getMinutes() === 0;

        if (isMidnight) {
            const previousDayTime = new Date(now.getTime() - 86400000);
            const previousData = findPreviousData(previousDayTime);
            const pluginData = await fetchPluginData(previousData);
            storeData(pluginData, now);
            storeDataAsEndOfDay(pluginData, previousDayTime);
        } else {
            const previousData = findPreviousData(now);
            const pluginData = await fetchPluginData(previousData);
            storeData(pluginData, now);
        }
    } catch (error) {
        console.error('Error during fetchData:', error);
    }
}

// 读取指定日期和时间的数据
function readDataByDateTime(year, month, day, time) {
    const dirPath = path.join(__dirname, 'data', year, month, day);
    const fileName = `${time}.json`;
    const filePath = path.join(dirPath, fileName);

    if (fs.existsSync(filePath)) {
        const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return fileData;
    } else {
        return null;
    }
}

app.get('/fetch-plugin-data', async (req, res) => {
    console.log('Received request to fetch plugin data');
    try {
        await fetchData();
        console.log('Successfully fetched plugin data');
        res.json({ success: true });
    } catch (error) {
        console.error('Error fetching plugin data:', error);
        res.status(500).json({ error: 'Failed to fetch plugin data' });
    }
});

async function fetchPluginData(previousData) {
    console.log('Starting to fetch plugin data from API');
    try {
        const searchQueries = [
            'canned style',
            'snippet',
            '蓝湖',
            'zeplin team across'
        ];

        let allPlugins = [];
        
        for (const query of searchQueries) {
            console.log(`\n=== Processing query: ${query} ===`);
            const url = `https://www.figma.com/api/search/resources?query=${encodeURIComponent(query)}&price=all&creators=all&sort_by=relevancy&resource_type=plugin`;
            let attempt = 0;
            let response = null;
            let success = false;
            while (attempt < 10 && !success) {
                try {
                    console.log(`Making API request to: ${url} (attempt ${attempt + 1})`);
                    response = await axios.get(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept': 'application/json',
                            'Referer': 'https://www.figma.com/',
                            'Origin': 'https://www.figma.com'
                        },
                        timeout: 10000
                    });
                    if (response.data && response.data.meta && Array.isArray(response.data.meta.results) && response.data.meta.results.length > 0) {
                        success = true;
                    } else {
                        console.warn('No valid data, will retry...');
                        await new Promise(r => setTimeout(r, 400));
                    }
                } catch (error) {
                    console.error(`Error fetching data for query "${query}" (attempt ${attempt + 1}):`, error.message);
                    if (error.response) {
                        console.error('Response status:', error.response.status);
                        console.error('Response headers:', JSON.stringify(error.response.headers, null, 2));
                        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
                    }
                    await new Promise(r => setTimeout(r, 400));
                }
                attempt++;
            }
            if (!success) {
                console.error(`Failed to fetch valid data for query "${query}" after 10 attempts.`);
                continue;
            }

            // 检查响应数据结构
            console.log('Response data structure:', Object.keys(response.data));
            
            // 检查是否有错误
            if (response.data.error) {
                console.error('API Error:', response.data.error);
                console.error('API Status:', response.data.status);
                continue;
            }

            // 获取插件数据
            const plugins = response.data.meta.results;
            console.log(`\nFound ${plugins.length} plugins for query "${query}"`);
            
            // 过滤出我们关注的插件
            const targetPlugins = plugins.filter(plugin => {
                const name = plugin.model.name.toLowerCase();
                const isTarget = name.includes('lanhu') || 
                               name.includes('moonvy') || 
                               name.includes('codesign') || 
                               name.includes('zeplin') || 
                               name.includes('mock') || 
                               name.includes('canned');
                if (isTarget) {
                    console.log(`Found target plugin: ${plugin.model.name} (ID: ${plugin.model.id})`);
                }
                return isTarget;
            });

            console.log(`\nFound ${targetPlugins.length} target plugins for query: ${query}`);
            if (targetPlugins.length > 0) {
                console.log('Target plugins:', JSON.stringify(targetPlugins.map(p => ({
                    id: p.model.id,
                    name: p.model.name,
                    user_count: p.model.user_count,
                    like_count: p.model.like_count
                })), null, 2));
            }

            // 处理每个插件的数据
            const processedPlugins = targetPlugins.map(plugin => {
                const currentUsers = plugin.model.user_count || 0;
                const currentLikes = plugin.model.like_count || 0;
                const pluginId = plugin.model.id;
                const previousPlugin = previousData ? previousData.find(p => p.id === pluginId) : null;
                
                if (previousPlugin) {
                    console.log(`Found previous data for plugin ${plugin.model.name}:`, {
                        current_users: currentUsers,
                        previous_users: previousPlugin.users,
                        current_likes: currentLikes,
                        previous_likes: previousPlugin.likes
                    });
                } else {
                    console.log(`No previous data found for plugin ${plugin.model.name}`);
                }

                const previousUsers = previousPlugin ? parseInt(previousPlugin.users) : null;
                const previousLikes = previousPlugin ? parseInt(previousPlugin.likes) : null;
                
                const DoDCount = previousUsers ? currentUsers - previousUsers : '--';
                const DoDPercent = previousUsers ? ((DoDCount / previousUsers) * 100).toFixed(2) + '%' : '--';
                
                const DoDLikes = previousLikes ? currentLikes - previousLikes : '--';
                const DoDLikesPercent = previousLikes ? ((DoDLikes / previousLikes) * 100).toFixed(2) + '%' : '--';

                return {
                    id: pluginId,
                    name: plugin.model.name,
                    users: currentUsers.toString(),
                    likes: currentLikes.toString(),
                    DoDCount: DoDCount.toString(),
                    DoDPercent,
                    DoDLikes: DoDLikes.toString(),
                    DoDLikesPercent
                };
            });

            allPlugins = allPlugins.concat(processedPlugins);
        }

        console.log(`\n=== Final Results ===`);
        console.log(`Total plugins collected: ${allPlugins.length}`);
        if (allPlugins.length > 0) {
            console.log('Collected plugins:', JSON.stringify(allPlugins, null, 2));
        } else {
            console.log('No plugins were collected. This might be due to:');
            console.log('1. No matching plugins found in the API response');
            console.log('2. API response structure might have changed');
            console.log('3. Search queries might need to be updated');
        }
        return allPlugins;
    } catch (error) {
        console.error('Error in fetchPluginData:', error);
        throw error;
    }
}

function constructDirectory() {
    const basePath = path.join(__dirname, 'data');
    let directory = {};

    function exploreDirectory(dirPath, current) {
        fs.readdirSync(dirPath, { withFileTypes: true }).forEach(dirent => {
            if (dirent.isDirectory()) {
                const nextPath = path.join(dirPath, dirent.name);
                if (!current[dirent.name]) current[dirent.name] = {};
                exploreDirectory(nextPath, current[dirent.name]);
            } else {
                if (dirent.name.endsWith('.json')) {
                    if (!current.times) current.times = [];
                    current.times.push(dirent.name.replace('.json', ''));
                }
            }
        });
    }

    exploreDirectory(basePath, directory);
    return directory;
}

app.get('/get-data', (req, res) => {
    const { year, month, day, time } = req.query;
    try {
        const data = readDataByDateTime(year, month, day, time);
        res.json(data);
    } catch (error) {
        console.error("Error fetching data:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

app.get('/get-directory', (req, res) => {
    try {
        const directory = constructDirectory();
        res.json(directory);
    } catch (error) {
        console.error('Failed to construct directory:', error);
        res.status(500).json({ error: 'Failed to get directory' });
    }
});

function deleteTimeData(year, month, day, time) {
    const filePath = path.join(__dirname, 'data', year, month, day, `${time}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

// 添加一个简单的测试路由
app.get('/test', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.delete('/delete-time-data', (req, res) => {
    const { year, month, day, time } = req.query;
    if (!year || !month || !day || !time) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    const result = deleteTimeData(year, month, day, time);
    if (result) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: 'Data not found' });
    }
});