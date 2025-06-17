const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const port = 1181;

app.use(express.static('public'));

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
    console.log(`Server is running on 1181`);
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
    try {
        await fetchData();
        res.json({ success: true });
    } catch (error) {
        console.error('Error fetching plugin data:', error);
        res.status(500).json({ error: 'Failed to fetch plugin data' });
    }
});

async function fetchPluginData(previousData) {
    try {
        const searchQueries = [
            'canned style',
            'snippet',
            '蓝湖',
            'zeplin team across'
        ];

        let allPlugins = [];
        
        for (const query of searchQueries) {
            const url = `https://www.figma.com/api/feed/plugins?query=${encodeURIComponent(query)}&category=editing-effects&creators=all&editor_type=all&include_tags=true&price=all&sort_by=all_time&page_size=48`;
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            const plugins = response.data.plugins || [];
            
            // 过滤出我们关注的插件
            const targetPlugins = plugins.filter(plugin => {
                const name = plugin.name.toLowerCase();
                return name.includes('lanhu') || 
                       name.includes('moonvy') || 
                       name.includes('codesign') || 
                       name.includes('zeplin') || 
                       name.includes('mock') || 
                       name.includes('canned');
            });

            // 处理每个插件的数据
            const processedPlugins = targetPlugins.map(plugin => {
                const currentUsers = plugin.install_count || 0;
                const sortName = plugin.name.slice(0, 20);
                const previousPlugin = previousData ? previousData.find(p => p.name.slice(0, 20) === sortName) : null;
                const previousUsers = previousPlugin ? parseInt(previousPlugin.users) : null;
                const DoDCount = previousUsers ? currentUsers - previousUsers : '--';
                const DoDPercent = previousUsers ? ((DoDCount / previousUsers) * 100).toFixed(2) + '%' : '--';

                return {
                    name: plugin.name,
                    users: currentUsers.toString(),
                    DoDCount: DoDCount.toString(),
                    DoDPercent
                };
            });

            allPlugins = allPlugins.concat(processedPlugins);
        }

        return allPlugins;
    } catch (error) {
        console.error('Error fetching plugin data:', error);
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
