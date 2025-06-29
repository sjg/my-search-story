const express = require('express');
const { google } = require('googleapis');
const https = require('https');
const dayjs = require('dayjs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const JSZip = require("jszip");
const path = require('node:path');
const fs = require('fs');

const { exec } = require('child_process');
const { marked } = require('marked');
const { JSDOM } = require('jsdom');
const DOMPurify = require('dompurify');
const util = require('util');
const execPromise = util.promisify(exec);

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {TextToSpeechClient} = require('@google-cloud/text-to-speech');

require('dotenv').config();

const app = express();
const port = process.env.APP_PORT;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL + ":"+port+"/oauth2callback"
);

const gcp_project_id = process.env.GCP_PROJECT_ID;
const gen_ai_api_key = process.env.GOOGLE_GEN_API_KEY;

app.use(cookieParser());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/views'));

//Set static folder
app.use(express.static(path.join(__dirname, '/static')));
app.use("/data", express.static(__dirname + "/data"));

// Generate the auth URL
app.get('/', (req, res) => {
    if (req.cookies.dpapi_token) {
      var token = JSON.parse(req.cookies.dpapi_token);
      const url = 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token.access_token; // Replace with the actual URL
      var status = "";

      getJsonFromUrlSync(url)
        .then(jsonData => {
          console.log(jsonData);
          status = "<br/><h3>Great Let's create a Story</a></h3>";
          res.render('index.ejs', { current_status: status, authd: 1 });
        })
        .catch(error => {
          console.error('Error fetching data:', error);
          req.cookies.dpapi_token = null;
          status = '<br/><br/><br/><h1>Login to Fetch your <a href="/auth">Search Data</a></h1>';
          res.render('index.ejs', { current_status: status, authd: 0 });
        });
    } else {
        status = '<br/><br/><br/><h1>Login to Fetch your <a href="/auth">Search Data</a></h1>';
        res.render('index.ejs', { current_status: status, authd: 0 });
    }
});

app.get('/submitDataJob/:SCOPE/:START/:STOP', (req, res) => { // This should probably be a POST
    var start = req.params.START;
    var stop = req.params.STOP;

    if (stop == 'null' || stop == '0') {
        stop = dayjs().toISOString();
    }

    if (start == 'null' || start == '0') {
        start = dayjs().subtract(12, 'months').toISOString();
    }

    console.log('Data Job Submitted: ' + req.params.SCOPE + ' ' + start + ' ' + stop);

    if (req.cookies.dpapi_token) {
        var token = JSON.parse(req.cookies.dpapi_token);
        var scope = req.params.SCOPE;
        initiateDataPortabilityArchive(token.access_token, [scope], start, stop).then(response => {
            console.log('Archive initiation response:', response);
            res.json({ jobId: response.archiveJobId });
        }).catch(error => {
            console.error('Error initiating archive:', error);
            res.status(500).json({ error: 'Error initiating archive: ' + error.message });
        });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

app.get('/archive/', (req, res) => {
    getFolderData()
        .then(storyArray => {
            // Sort by creation date, newest first
            storyArray.sort((a, b) => new Date(b.created) - new Date(a.created));
            //console.log(storyArray); 
            res.render('archive.ejs', { 
                archive: storyArray 
            });
        })
        .catch(error => {
            res.render('archive.ejs', { 
                archive: [] 
            });
        });
});

app.get('/jobs', (req, res) => {
    getJobsAndStoriesData()
        .then(jobsData => {
            res.render('jobs.ejs', { 
                jobs: jobsData 
            });
        })
        .catch(error => {
            console.error('Error getting jobs data:', error);
            res.render('jobs.ejs', { 
                jobs: [] 
            });
        });
});

app.get('/archive/:job_id/', (req, res) => {
    res.redirect('/archive');
}); 

app.get('/archive/:job_id/:story_id', (req, res) => {
    var job_id = req.params.job_id;
    var story_id = req.params.story_id;

    //Fetch JSON file from local link
    var json = fs.readFileSync('./data/'+job_id+'/stories/'+story_id+'/story.json');
    var storyObj = JSON.parse(json);
    
    //Remove first line of story for the title
    var title = storyObj.title;
    storyObj.story = storyObj.story.replace(title +'\n\n', '');

    var tag_array = storyObj.searchHistory.split('\n');

    // Loop Around the story array and delete the quotes and delete empty entries
    for(var i=0; i <= tag_array.length-1; i++){
        if(tag_array[i] != undefined){
            // If empty string, remove it
            if(tag_array[i] == ""){
                tag_array.splice(i, 1);
            }else if(tag_array[i].includes('"https://')){
                tag_array.splice(i, 1);
            }else{
                tag_array[i] = tag_array[i].replace(/["\\]/g, "").replace('"', "").replace('"', '').replace("...", "").replace("Viewed ", "").replace("Searched for ", "");
            }
        }
    }
    
    title = title.replace(/#/g, '');
    storyObj.title = title.replace("#", '');

    storyObj.story = markdownToHtml(storyObj.story.replace(/\n/g, '<br>'));
    storyObj.image = storyObj.image.replace("./", '/');
    storyObj.audio = storyObj.audio.replace("./", '/');
    storyObj.tags = tag_array;
    
    res.render('story.ejs', { title: title, story: storyObj });
});

app.get('/checkJob/:JOB_ID', (req, res) => {
    //e11e7ab5-af9c-4de3-b92c-f1de2a2235c2
    if (req.cookies.dpapi_token) {
        var token = JSON.parse(req.cookies.dpapi_token);
        var jobID = req.params.JOB_ID;
        console.log("Job Status: " + req.params.JOB_ID);
        checkJob(token.access_token, jobID).then(response => {
            console.log('Job response:', response);
            res.send(response)
        }).catch(error => {
            console.error('Job Error:', error);
        });
    }else{
        res.send('No Token \'dpapi_token\' found. Auth first <a href="/auth">here</a>');
    }
});

app.get('/getData/:JOB_ID', (req, res) => {
    console.log(req.params.JOB_ID);
    if (req.cookies.dpapi_token) {
        var token = JSON.parse(req.cookies.dpapi_token);
        var jobID = req.params.JOB_ID;
        console.log("Job Status: " + req.params.JOB_ID);
        checkJob(token.access_token, jobID).then(response => {
            console.log('Job response:', response);
            if (response.state == 'COMPLETE') {
                downloadAndUnzip(response.urls[0], './data/'+jobID);
                res.send("Downloaded Requested Data to" + './data/'+jobID);
            }else{
                res.send(response)
            }
        }).catch(error => {
            console.error('Job Error:', error);
        });
    }else{
        res.send('No Token \'dpapi_token\' found. Auth first <a href="/auth">here</a>');
    }
});

app.get('/generateStory/:JOB_ID', (req, res) => {
    var id = req.params.JOB_ID;
    // Get the search data from the job
    var path = './data/'+id+'/Portability/My\ Activity/Search/MyActivity.json';
    
    generateStory(id, path).then(response => {
        // Set headers for json object
        res.setHeader('Content-Type', 'application/json');
        res.send(response)
    }).catch(error => {
        console.error('Story Error:', error);
    });
});

app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', 
    scope: ['https://www.googleapis.com/auth/dataportability.myactivity.search', 'https://www.googleapis.com/auth/dataportability.chrome.history'], 
  });
  res.redirect(authUrl);
});

// Handle the callback from Google
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    res.cookie("dpapi_token", JSON.stringify(tokens), {
        secure: true,
        httpOnly: true,
        expires: dayjs().add(30, "days").toDate(),
    });

    //res.send('Authentication successful! Go Back to <a href="/">Homepage</a>');
    res.redirect('/');


  } catch (error) {
    console.error('Error retrieving access token:', error);
    //res.status(500).send('Authentication failed.');
    res.redirect('/');

  }
});

async function getJsonFromUrlSync(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
        if (res.statusCode !== 200) {
            reject(new Error(`Status Code: ${res.statusCode}`));
            return;
        }

        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
            resolve(JSON.parse(data));
            } catch (error) {
            reject(new Error('Error parsing JSON: ' + error));
            }
        });
        });

        req.on('error', (error) => {
        reject(error);
        });

        req.end();
    });
}

async function initiateDataPortabilityArchive(accessToken, resources = ['myactivity.search'], start, stop) {
  const url = 'https://dataportability.googleapis.com/v1/portabilityArchive:initiate';
  const body = JSON.stringify({ "resources": resources, 
                                "start_time": start,
                                "end_time": stop  
                              });

  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body,
  };

  console.log(options);

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`Error initiating archive: Status code ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error initiating archive:', error);
    throw error; // Re-throw for potential handling in calling code
  }
}

async function checkJob(accessToken, jobID) {
    const url = 'https://dataportability.googleapis.com/v1/archiveJobs/'+jobID+'/portabilityArchiveState';
  
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      }
    };
  
    console.log(options);
  
    try {
      const response = await fetch(url, options);
  
      if (!response.ok) {
        throw new Error(`Error initiating archive: Status code ${response.status}`);
      }
  
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error initiating archive:', error);
      throw error; // Re-throw for potential handling in calling code
    }
}

async function generateStory(jobID, dataPath){
    console.log(dataPath);
    console.log('cat '+ dataPath + ' | jq \'.[].title | sub("^Searched for "; "") | sub("^Visited "; "")\'');
    const { stdout } = await execPromise('cat "'+ dataPath + '" | jq \'.[].title | sub("^Searched for "; "") | sub("^Visited "; "")\' | shuf -n 50');
    
    var searchHistory = stdout;
    console.log(stdout);

    const genAI = new GoogleGenerativeAI(gen_ai_api_key);
    
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: `
        
        Your Role: You are a creative storyteller AI. Your primary function is to generate a short story based on the user's provided search terms, following a strict output format.

        **Strict Output Format (Follow these rules without exception):**

        1.  **Line 1: Title:** The very first line of your output must be the story's title.
        2.  **Title Constraints:** The title must be **7 words or fewer**. It should not be enclosed in quotes or any other punctuation.
        3.  **Line Breaks:** After the title, you must insert exactly **two** new line characters which are \n\n.
        4.  **Body:** Following the two new lines, write the story itself.

        **Content Generation Guidelines:**

        * **Protagonist:** Invent a new, random name for the protagonist in every story.
        * **Incorporate Searches:** The story must be built around the themes, items, or ideas found in the user's list of recent searches.
        * **Length:** The story should be approximately 400 words.
        * **Genre:** You have creative freedom. The story can be fantastical, realistic, humorous, or any other genre that fits the search terms.

        **Example Interaction:**

        **User Input:**
        \`Create a story based on my recent searches: "ancient Roman recipes", "stargazing applications for phone", "lost cat posters in my area"\`

        **Your Expected Output:**

        TITLE \\n\\n STORY`
    });
    
    console.log("Create a story based on my recent searches: " + searchHistory);

    const result = await model.generateContent("Create a story based on my recent searches: " + searchHistory);

    const { v4: uuidv4 } = require('uuid');
    const audioUUID = uuidv4(); // Generate a UUID

    var story = result.response.text();
    console.log(story);

    var audioFilePath = "./data/"+jobID+"/stories/" + audioUUID + "/" + audioUUID + ".mp3"
    
    if (!fs.existsSync(path.dirname(audioFilePath))){
        await fs.promises.mkdir(path.dirname(audioFilePath), { recursive: true });
    }

    synthesizeText(story, 'en-GB-Studio-C', "./data/"+jobID+"/stories/" + audioUUID + "/" + audioUUID + ".mp3");

    // Call generateStoryTitle(jobID, storyText) and use the returned value as the title
    const title = await generateStoryTitle(jobID, story);
    var json = {};
    
    json.story = story;
    json.searchHistory = searchHistory;
    json.audio = "./data/"+jobID+"/stories/" + audioUUID + "/" + audioUUID + ".mp3";
    json.image = "./data/"+jobID+"/stories/" + audioUUID + "/background.png";
    json.storyID = audioUUID;
    json.title = title; 
    json.created = dayjs().toISOString()

    await generateBackgroundImage(jobID, json.title, json.image);
    
    // Save the story to a JSON file
    fs.writeFileSync("./data/"+jobID+"/stories/"+audioUUID+"/story.json", JSON.stringify(json));

    return JSON.stringify(json);
}

async function generateStoryTitle(jobID, storyText){
  // Use genAI.getGenerativeModel function and the moodel: "gemini-2.0-flash", create a title for the story in no more than 6 words
  // prompt: Generate a title of no more than 6 words for this story: ...
  const genAI = new GoogleGenerativeAI(gen_ai_api_key);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Generate one title of no more than 6 words for the following story: ${storyText}.  The title should jsut be 6 words and not a list of possible title, generate only one title`;
  
  const result = await model.generateContent(prompt);
  const title = result.response.text();
  
  console.log("Story Title: " + title);

  // Clean up the title, removing quotes and newlines
  return title.replace(/(\r\n|\n|\r|")/gm, "").replace(/\*/g, '');
}

async function generateBackgroundImage(jobID, storyText, imgPath){
  // Generate background image using Imagen model and save it to the imgPath
  try {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const accessToken = await auth.getAccessToken();

    const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${gcp_project_id}/locations/us-central1/publishers/google/models/imagegeneration@006:predict`;
    
    const prompt = `A beautiful and evocative background image for a story. The story starts like this: ${storyText}. The image should be high-quality, photorealistic, with cinematic and dramatic lighting and fit with a dark backgorund which is currently black around the side.`;

    const body = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: 1
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error from image generation API: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (data.predictions && data.predictions.length > 0 && data.predictions[0].bytesBase64Encoded) {
      const imageBase64 = data.predictions[0].bytesBase64Encoded;
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      fs.writeFileSync(imgPath, imageBuffer);
      console.log(`Background image saved to ${imgPath}`);
    } else {
      console.error('No image predictions found in API response.');
    }
  } catch (error) {
    console.error('Error generating background image:', error);
  }
}

async function synthesizeText(text, voiceName = 'en-US-Standard-C', outputFile = 'output.mp3') {
    const client = new TextToSpeechClient();
  
    text = text.replace("###", "").replace("##", "").replace("#", "").substring(0, 2500);

    const request = {
      input: {text: text},
      voice: {languageCode: 'en-GB', name: voiceName},
      audioConfig: {audioEncoding: 'MP3'},
    };
  
    try {
      const [response] = await client.synthesizeSpeech(request);
      const writeStream = require('fs').createWriteStream(outputFile);
      writeStream.write(response.audioContent);
      writeStream.end();
      console.log(`Audio content written to file: ${outputFile}`);
    } catch (error) {
      console.error('Error synthesizing speech:', error);
    }
}

async function downloadAndUnzip(url, destinationFolder) {
    try {
      // Fetch the zip file
      const options = {
        method: 'GET',
        headers: {}
      };
      const response = await fetch(url, options);
      const Buffer = require('buffer').Buffer 

      console.log(url);
        
      if (!response.ok) {
        throw new Error(`Error initiating archive: Status code ${response.status}`);
      }else{
        console.log('Downloaded');
        var dataBlob = await response.blob();
        var buffer = await dataBlob.arrayBuffer();

        // Use a JSZip to unzip the file
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(buffer);
  
        // Iterate through the files in the zip
        for (const filename in zip.files) {
            const file = zip.files[filename];
            if (!file.dir) { // Only process files, not directories
                const fileContent = await file.async('arraybuffer');
                const blob = new Blob([fileContent], { type: file.type });
        
                // Create a file path within the destination folder
                const filePath = `${destinationFolder}/${filename}`;
            
                // Save the file to the local file system
                if (!fs.existsSync(path.dirname(filePath))){
                    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                }

                // Convert the blob to a buffer
                var buffer = Buffer.from(await blob.arrayBuffer());
                
                // Write the buffer to a file on the local file system
                fs.writeFileSync(filePath, buffer);            
            }
        }
  
      }
    
      console.log('Download and unzip complete!');
  
    } catch (error) {
      console.error('Error downloading or unzipping:', error);
    }
}

async function getFolderData() {
    try {
      const rootFolderPath = './data/'; // Replace with your root folder path
      const folderArray = [];
  
      // Get all folders within the root folder
      const folders = await fs.promises.readdir(rootFolderPath, { withFileTypes: true })
        .then(items => items.filter(item => item.isDirectory()));
  
      // Loop through each folder
      for (const folder of folders) {
        const folderPath = path.join(rootFolderPath, folder.name);

        const storyFolders = await fs.promises.readdir(folderPath + "/stories/", { withFileTypes: true })
        .then(items => items.filter(item => item.isDirectory()));
        
        for (const stories of storyFolders) {
            const storyFolderPath = path.join(folderPath + "/stories/", stories.name);
            console.log(storyFolderPath)
            const storyFilePath = path.join(storyFolderPath, 'story.json');
            console.log(storyFilePath);
        
            try {
            // Read the story.json file
            const storyData = await fs.promises.readFile(storyFilePath, 'utf-8');
            const storyJson = JSON.parse(storyData);
    
            if(storyJson.title == undefined){
                storyJson.title = "TITLE"
            }
            if(storyJson.created == undefined){
                storyJson.created = dayjs().toISOString()
            }
            
            var storyObj = {};
            storyObj.title = storyJson.title ;
            storyObj.created = storyJson.created;
            storyObj.jobID = folder.name;
            storyObj.id = stories.name;

            // Push folder information to the array
            folderArray.push(storyObj);
            } catch (err) {
                console.error(`Error reading story.json in folder ${folder.name}:`, err);
            }
        }
      }

      return folderArray;
    } catch (err) {
      console.error('Error reading folders:', err);
      return [];
    }
  }

  async function getJobsAndStoriesData() {
    try {
        const rootFolderPath = './data/';
        const jobsData = [];

        // Get all job folders
        const jobFolders = await fs.promises.readdir(rootFolderPath, { withFileTypes: true })
            .then(items => items.filter(item => item.isDirectory()));

        for (const jobFolder of jobFolders) {
            const jobID = jobFolder.name;
            const jobInfo = {
                jobID: jobID,
                stories: []
            };

            const storiesFolderPath = path.join(rootFolderPath, jobID, 'stories');
            
            if (fs.existsSync(storiesFolderPath)) {
                const storyFolders = await fs.promises.readdir(storiesFolderPath, { withFileTypes: true })
                    .then(items => items.filter(item => item.isDirectory()));

                for (const storyFolder of storyFolders) {
                    const storyID = storyFolder.name;
                    const storyFilePath = path.join(storiesFolderPath, storyID, 'story.json');

                    try {
                        const storyData = await fs.promises.readFile(storyFilePath, 'utf-8');
                        const storyJson = JSON.parse(storyData);

                        jobInfo.stories.push({
                            id: storyID,
                            title: storyJson.title || "Untitled Story",
                            created: storyJson.created || dayjs().toISOString()
                        });
                    } catch (err) {
                        console.error(`Error reading story.json in ${storiesFolderPath}:`, err);
                    }
                }
            }
            jobInfo.stories.sort((a, b) => new Date(b.created) - new Date(a.created));
            jobsData.push(jobInfo);
        }
        jobsData.sort((a, b) => a.jobID.localeCompare(b.jobID));
        return jobsData;
    } catch (err) {
        console.error('Error reading job folders:', err);
        return [];
    }
}

function markdownToHtml(markdown) {
  const window = new JSDOM('').window;
  const purify = DOMPurify(window);
  const rawHtml = marked.parse(markdown);
  const cleanHtml = purify.sanitize(rawHtml);
  return cleanHtml;
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});