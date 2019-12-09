const config = require('./config');

const voiceit2 = require('voiceit2-nodejs')
let myVoiceIt = new voiceit2(config.apiKey, config.apiToken);
var numTries = 0;

const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const express = require('express')
const bodyParser = require('body-parser');

var mysql = require('promise-mysql2');

var pool  = mysql.createPool({
    connectionLimit : 10,
    host     : 'remotemysql.com',
    user     : '58y5021f53',
    password : '1sxcXeilmn',
    database : '58y5021f53'
});

var rp = require('request-promise');

//const pool = pool1.promise();

const PORT = process.env.PORT || 5000

express()
  .use(bodyParser.urlencoded({extended: true}))
  .use(bodyParser.json())
  .post('/incoming_call', (req, res) => incomingCall(req, res))
  .post('/enroll_or_verify', (req, res) => enrollOrVerify(req, res))
  .post('/enroll', (req, res) => enroll(req, res))
  .post('/process_enrollment', (req, res) => processEnrollment(req, res))
  .post('/verify', (req, res) => verify(req, res))
  .post('/process_verification', (req, res) => processVerification(req, res))
  .listen(PORT, () => console.log(`Listening on port ${ PORT }`))

const callerUserId = async (phone) => {
  //try {
    // const client = await pool.getConnection()
    // const result = await client.query('SELECT userId FROM users where phone=\'' + phone + '\'');
    // client.release();
    // await pool.query('SELECT userid FROM users where phone=\'' + phone + '\'', function(err, result) {
    //     if (err) throw new Error(err);
    //     console.log('executing SELECT userid FROM users where phone=\'' + phone + '\'');
    //     console.log('user id in select is '+result[0].userid);
    //         // Check for user in db
    //     return result[0].userid;
    // });
    const [result, fields] = await pool.query('SELECT userid FROM users where phone=\'' + phone + '\'');
    console.log(result);
    if(result.length !== 0)
      return result[0].userid;
    else
      return -1;

  // } catch (err) {
  //     console.error(err);
  // }
  //return 0;
};

const incomingCall = async (req, res) => {
  const twiml = new VoiceResponse();
  console.log(req);
  const phone = removeSpecialChars(req.body.From);
  const userId = await callerUserId(phone);

  // Check for user in VoiceIt db
  await myVoiceIt.checkUserExists({
    userId :userId
  }, async (jsonResponse)=>{
    // User already exists
    if(jsonResponse.exists === true && userId !== -1) {
      // Greet the caller when their account profile is recognized by the VoiceIt API.
      speak(twiml, "Welcome back to the Paypal offline payment service, your phone number has been recognized");
      // Let's provide the caller with an opportunity to enroll by typing `1` on
      // their phone's keypad. Use the <Gather> verb to collect user input
      const gather = twiml.gather({
        action: '/enroll_or_verify',
        numDigits: 1,
        timeout: 5
      });
      speak(gather, "You may now log in, or press one to re enroll");
      twiml.redirect('/enroll_or_verify?digits=TIMEOUT');
      res.type('text/xml');
      res.send(twiml.toString());

    } else {
      // Create a new user for new number
      await myVoiceIt.createUser(async (jsonResponse)=>{
        speak(twiml, "Welcome back to the Paypal offline payment service, you are a new user and will now be enrolled");
        try {
          console.log('done');
          // const client = await pool.connect()
          // const result = await client.query('insert into users values ('+ phone +', \'' + jsonResponse.userId + '\')');
          // client.release();
          // await pool.query('insert into users(phone, userID) values (\''+ phone +'\', \'' + jsonResponse.userId + '\')', function(err, result) {
          //     if (err) throw new Error(err);

          //     console.log('executing insert into users(phone, userID) values (\''+ phone +'\', \'' + jsonResponse.userId + '\')');
          //     console.log('Result in insert is '+ result);
          //     // return jsonResponse.userId;
          // });
          const [result, fields] = await pool.query("insert into users(phone, userID) values (\'"+ phone +"\',\'" + jsonResponse.userId+"\')");
          console.log(result);
          //return result[0].userid;

        } catch (err) {
          console.error(err);
          res.send("Error " + err);
        }

        twiml.redirect('/enroll');
        res.type('text/xml');
        res.send(twiml.toString());
      });
    }
  });
};

// Routing Enrollments & Verification
// ------------------------------------
// We need a route to help determine what the caller intends to do.
const enrollOrVerify = async (req, res) => {
  const digits = req.body.Digits;
  const phone = removeSpecialChars(req.body.From);
  const twiml = new VoiceResponse();
  const userId = await callerUserId(phone);
  // When the caller asked to enroll by pressing `1`, provide friendly
  // instructions, otherwise, we always assume their intent is to verify.
  if (digits == 1) {
    //Delete User's voice enrollments and re-enroll
    myVoiceIt.deleteAllEnrollments({
      userId: userId,
      }, async (jsonResponse)=>{
        console.log("deleteAllEnrollments JSON: ", jsonResponse.message);
        speak(twiml, "You have chosen to re enroll your voice, you will now be asked to say a phrase three times, then you will be able to log in with that phrase");
        twiml.redirect('/enroll');
        res.type('text/xml');
        res.send(twiml.toString());
    });

  } else {
    //Check for number of enrollments > 2
    await myVoiceIt.getAllVoiceEnrollments({
      userId: userId
      }, async (jsonResponse)=>{
        speak(twiml, "You have chosen to verify your Voice.");
        console.log("jsonResponse.message: ", jsonResponse.message);
        const enrollmentsCount = jsonResponse.count;
        console.log("enrollmentsCount: ", enrollmentsCount);
        if(enrollmentsCount > 2){
          twiml.redirect('/verify');
          res.type('text/xml');
          res.send(twiml.toString());
        } else{
          speak(twiml, "You do not have enough enrollments and need to re enroll your voice.");
          //Delete User's voice enrollments and re-enroll
          myVoiceIt.deleteAllEnrollments({
            userId: userId,
            }, async (jsonResponse)=>{
              console.log("deleteAllEnrollments JSON: ", jsonResponse.message);
              twiml.redirect('/enroll');
              res.type('text/xml');
              res.send(twiml.toString());
          });
        }
    });
  }
};

// Enrollment Recording
const enroll = async (req, res) => {
  const enrollCount = req.query.enrollCount || 0;
  const twiml = new VoiceResponse();
  speak(twiml, 'Please say the following phrase to enroll ');
  speak(twiml, config.chosenVoicePrintPhrase, config.contentLanguage);

  twiml.record({
    action: '/process_enrollment?enrollCount=' + enrollCount,
    maxLength: 5,
    trim: 'do-not-trim'
  });
  res.type('text/xml');
  res.send(twiml.toString());
};

// Process Enrollment
const processEnrollment = async (req, res) => {
  const phone = removeSpecialChars(req.body.From);
  console.log('phone in processEnrollment is '+phone);
  const userId = await callerUserId(phone);
  console.log('user id in processEnrollment is '+userId);
  var enrollCount = req.query.enrollCount;
  const recordingURL = req.body.RecordingUrl + ".wav";
  const twiml = new VoiceResponse();


  console.log('recording url ' + recordingURL);

  function enrollmentDone(){
      enrollCount++;
      // VoiceIt requires at least 3 successful enrollments.
      if (enrollCount > 2) {
        speak(twiml, 'Thank you, recording received, you are now enrolled and ready to log in');
        twiml.redirect('/verify');
      } else {
        speak(twiml, 'Thank you, recording received, you will now be asked to record your phrase again');
        twiml.redirect('/enroll?enrollCount=' + enrollCount);
      }
  }

  function enrollAgain(){
    speak(twiml, 'Your recording was not successful, please try again');
    twiml.redirect('/enroll?enrollCount=' + enrollCount);
  }

  // Sleep and wait for Twillio to make file available
  await new Promise(resolve => setTimeout(resolve, 1000));
  await myVoiceIt.createVoiceEnrollmentByUrl({
    userId: userId,
    audioFileURL: recordingURL,
    phrase: config.chosenVoicePrintPhrase,
    contentLanguage: config.contentLanguage,
  }, async (jsonResponse)=>{
      console.log("createVoiceEnrollmentByUrl json: ", jsonResponse.message);
      if ( jsonResponse.responseCode === "SUCC" ) {
        enrollmentDone();
      } else {
        enrollAgain();
      }

    res.type('text/xml');
    res.send(twiml.toString());
  });
}

// Verification Recording
const verify = async (req, res) => {
  var twiml = new VoiceResponse();

  speak(twiml, 'Please say the following phrase to verify your voice ');
  speak(twiml, config.chosenVoicePrintPhrase, config.contentLanguage);

  twiml.record({
    action: '/process_verification',
    maxLength: '5',
    trim: 'do-not-trim',
  });
  res.type('text/xml');
  res.send(twiml.toString());
};

// Process Verification
const processVerification = async (req, res) => {
  const userId = await callerUserId(removeSpecialChars(req.body.From));
  const recordingURL = req.body.RecordingUrl + '.wav';
  const twiml = new VoiceResponse();
  console.log('testing');
  // Sleep and wait for Twillio to make file available
  await new Promise(resolve => setTimeout(resolve, 1000));
  await myVoiceIt.voiceVerificationByUrl({
    userId: userId,
    audioFileURL: recordingURL,
    phrase: config.chosenVoicePrintPhrase,
    contentLanguage: config.contentLanguage,
    }, async (jsonResponse)=>{
      console.log("createVoiceVerificationByUrl: ", jsonResponse.message);

      if (jsonResponse.responseCode == "SUCC") {
        speak(twiml, 'Verification successful!, We ll soon integrate with AAman\'s code');
        var authHeader = "ACfc4270a8dcd1908b732ce2c86e90e548:22c07aa43a723a413fa2b02757ed7983";
        
        var auth = "Basic " + new Buffer(authHeader).toString("base64");
        //var jsonBody = {'From' : '+919591601428', 'To': '+19896420652'};
        var options = {
            method: 'POST',
            uri: 'https://studio.twilio.com/v1/Flows/FW489f1d26d21e9c3ab611ee89b0ae5520/Executions',
            headers : {
              'Authorization' : auth,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: {
              From : '+919591601428',
              To: '+19896420652'
            }
        };

        rp(options)
          .then(function (parsedBody) {
              console.log('post call done');
          })
          .catch(function (err) {
              throw err;
          });

        //Hang up
      } else if (numTries > 2) {
        //3 attempts failed
        speak(twiml,'Too many failed attempts. Please call back and select option 1 to re enroll and verify again.');
      } else {
        switch (jsonResponse.responseCode) {
          case "STTF":
              speak(twiml, "Verification failed. It seems you may not have said your enrolled phrase. Please try again.");
              numTries = numTries + 1;
              twiml.redirect('/verify');
              break;
          case "FAIL":
              speak(twiml,"Your verification did not pass, please try again.");
              numTries = numTries + 1;
              twiml.redirect('/verify');
              break;
          case "SSTQ":
              speak(twiml,"Please speak a little louder and try again.");
              numTries = numTries + 1;
              twiml.redirect('/verify');
              break;
          case "SSTL":
              speak(twiml,"Please speak a little quieter and try again.");
              numTries = numTries + 1;
              twiml.redirect('/verify');
              break;
          default:
              speak(twiml,"Something went wrong. Your verification did not pass, please try again.");
              numTries = numTries + 1;
              twiml.redirect('/verify');
          }
      }
      res.type('text/xml');
      res.send(twiml.toString());
  });

};

function speak(twiml, textToSpeak, contentLanguage = "en-US"){
  twiml.say(textToSpeak, {
    voice: "alice",
    language: contentLanguage
  });
}

function removeSpecialChars(text){
  return text.replace(/[^0-9a-z]/gi, '');
}
