const express = require("express");
const app = express();
app.use(express.json());

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is Running at http://localhost:3000/");
    });
  } catch (err) {
    console.log(`Error : ${err.message}`);
  }
};

initializeDBAndServer();

//MIDDLEWARE FUNCTION
//Authentication with JWT Token
//-->JWT Token is Created and called after API-2 login <--

//If the JWT token is not provided by the user or an invalid JWT token is provided
const tokenAuthentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        //username who logged in passing to all functions in which middleware is called
        request.username = payload.username;
        next();
      }
    });
  }
};

//API-1
//REGISTER NEW USER
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  //SCENARIO-1
  //If the username already exists
  const checkUserQuery = `
        SELECT *
            FROM user
        WHERE username='${username}';`;
  const checkUserResponse = await db.get(checkUserQuery);

  if (checkUserResponse !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    //SCENARIO-2
    //If the registrant provides a password with less than 6 characters
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      //SCENARIO-3
      //Successful login of the user
      const createNewUserQuery = `
            INSERT INTO user (name, username, password, gender)
                VALUES ('${name}', '${username}', '${hashedPassword}', '${gender}');`;
      await db.run(createNewUserQuery);

      response.status(200);
      response.send("User created successfully");
    }
  }
});

//API-2
//USER LOGIN IF EXISTS IN DB

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };

      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});
//API-3
// Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get(
  "/user/tweets/feed/",
  tokenAuthentication,
  async (request, response) => {
    let { username } = request;
    //GETTING USER_ID
    const getUserIdQuery = `
    SELECT user_id
        FROM user
    WHERE 
        username='${username}';`;
    const getUserIdResponse = await db.get(getUserIdQuery);

    //GET ID'S USER FOLLOWING
    const getFollowersQuery = `
    SELECT following_user_id
        FROM follower
    WHERE 
        follower_user_id=${getUserIdResponse.user_id}`;
    const getFollowersResponse = await db.all(getFollowersQuery);
    const getFollowerIdsEach = getFollowersResponse.map((eachUser) => {
      return eachUser.following_user_id;
    });

    //GETTING TWEETS WITH LIMIT-4
    const getTweetsQuery = `
    SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
        FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE user.user_id IN (${getFollowerIdsEach})
        ORDER BY 
            tweet.date_time DESC LIMIT 4 ;`;
    const getTweetsResponse = await db.all(getTweetsQuery);
    response.send(getTweetsResponse);
  }
);

//API-4
//Returns the list of all names of people whom the user follows
app.get("/user/following/", tokenAuthentication, async (request, response) => {
  let { username } = request;
  //GET USER ID
  const getUserIdQuery = ` 
        SELECT user_id
            FROM user
        WHERE 
            username='${username}';`;
  const getUserIdResponse = await db.get(getUserIdQuery);
  //GET USER FOLLOWING ID'S
  const getFollowingIds = `
        SELECT following_user_id
            FROM follower
        WHERE follower_user_id=${getUserIdResponse.user_id};`;
  const getFollowingIdsResponse = await db.all(getFollowingIds);
  const getEachFollowing = getFollowingIdsResponse.map((eachUser) => {
    return eachUser.following_user_id;
  });
  //GET FOLLOWING NAMES
  const getFollowingNames = `
    SELECT name
        FROM user
    WHERE user_id IN (${getEachFollowing});`;
  const getFollowingNamesResponse = await db.all(getFollowingNames);
  response.send(getFollowingNamesResponse);
});

//API-5
//Returns the list of all names of people who follows the user

app.get("/user/followers/", tokenAuthentication, async (request, response) => {
  let { username } = request;
  //GET USER ID
  const getUserIdQuery = `
    SELECT user_id
        FROM user
    WHERE 
        username='${username}'`;
  const getUserIdResponse = await db.get(getUserIdQuery);

  //GET FOLLOWER USER ID'S
  const getFollowersIds = `
    SELECT follower_user_id
        FROM follower
    WHERE 
        following_user_id=${getUserIdResponse.user_id};`;

  const getFollowersIdsResponse = await db.all(getFollowersIds);

  const getFollowerIds = getFollowersIdsResponse.map((eachUser) => {
    return eachUser.follower_user_id;
  });

  const getFollowerNames = `
  SELECT name
    FROM user
  WHERE 
    user_id IN (${getFollowerIds})`;
  const getFollowerNamesResponse = await db.all(getFollowerNames);
  response.send(getFollowerNamesResponse);
});

//API-6

//CONVERT TO OBJECT
const convertToObject = (tweets, likesCount, repliesCount) => {
  return {
    tweet: tweets.tweet,
    likes: likesCount.likes,
    replies: repliesCount.replies,
    dateTime: tweets.date_time,
  };
};

//GET TWEETS FOLLOWED BY USER
app.get("/tweets/:tweetId/", tokenAuthentication, async (request, response) => {
  const { tweetId } = request.params;
  let { username } = request;
  //GET USER ID
  const getUserIdQuery = `
            SELECT user_id
                FROM user
            WHERE 
                username='${username}';`;
  const getUserIdResponse = await db.get(getUserIdQuery);

  //GET ID'S USER FOLLOWING
  const getFollowingIds = `
        SELECT following_user_id
            FROM follower
        WHERE follower_user_id=${getUserIdResponse.user_id};`;
  const getFollowingIdsResponse = await db.all(getFollowingIds);
  const getEachFollowing = getFollowingIdsResponse.map((eachUser) => {
    return eachUser.following_user_id;
  });

  //GET TWEETS FOLLOWED BY USER
  const getTweetIdsQuery = `
    SELECT tweet_id 
        FROM tweet 
    WHERE 
        user_id in (${getEachFollowing});`;
  const getTweetIdsArray = await db.all(getTweetIdsQuery);
  const followingUserTweetIds = getTweetIdsArray.map((eachId) => {
    return eachId.tweet_id;
  });

  if (followingUserTweetIds.includes(parseInt(tweetId))) {
    const noOfLikesCountQuery = `
              SELECT count(user_id) as likes
                  FROM like
              WHERE tweet_id=${tweetId};`;
    const noOfLikesCountResponse = await db.get(noOfLikesCountQuery);

    const repliesCountQuery = `
          SELECT count(user_id) as replies
              FROM reply
          WHERE tweet_id=${tweetId};`;
    const repliesCountResponse = await db.get(repliesCountQuery);

    const dataOfTweetQuery = `
    SELECT tweet, date_time 
        FROM tweet 
    WHERE tweet_id=${tweetId};`;
    const dataOfTweetResponse = await db.get(dataOfTweetQuery);

    response.send(
      convertToObject(
        dataOfTweetResponse,
        noOfLikesCountResponse,
        repliesCountResponse
      )
    );
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API-7
// CONVERT TO OBJECT
const convertEachLikedNameToObject = (obj) => {
  return {
    likes: obj,
  };
};

//If the user requests a tweet of a user he is following,
// return the list of usernames who liked the tweet

app.get(
  "/tweets/:tweetId/likes/",
  tokenAuthentication,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    //GET USER ID
    const getUserIdQuery = `
            SELECT user_id
                FROM user
            WHERE 
                username='${username}';`;
    const getUserIdResponse = await db.get(getUserIdQuery);

    //GET USER FOLLOWING ID'S
    const userFollowing = `
    SELECT following_user_id
        FROM follower
    WHERE follower_user_id=${getUserIdResponse.user_id};`;
    const getFollowingIdsArr = await db.all(userFollowing);
    const getFollowingIds = getFollowingIdsArr.map((eachFollower) => {
      return eachFollower.following_user_id;
    });

    //GET TWEET ID AND CHECK MADE BY FOLLOWERS
    const getTweetIdsQuery = `
    SELECT tweet_id
        FROM tweet
    WHERE user_id in (${getFollowingIds});`;
    const getTweetIdArr = await db.all(getTweetIdsQuery);
    const getTweetArr = getTweetIdArr.map((eachTweet) => {
      return eachTweet.tweet_id;
    });

    if (getTweetArr.includes(parseInt(tweetId))) {
      const getLikedUsersQuery = `
        SELECT user.username AS likes
            FROM user INNER JOIN LIKE ON user.user_id = like.user_id
        WHERE like.tweet_id=${tweetId};`;
      const getLikedUserNames = await db.all(getLikedUsersQuery);
      const getLikedUser = getLikedUserNames.map((eachUser) => {
        return eachUser.likes;
      });
      response.send(convertEachLikedNameToObject(getLikedUser));
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API-8
//CONVERT OBJECT
const userReplyToObject = (obj) => {
  return {
    replies: obj,
  };
};

//If the user requests a tweet of a user he is following,
// return the list of replies.

app.get(
  "/tweets/:tweetId/replies/",
  tokenAuthentication,
  async (request, response) => {
    const { tweetId } = request.params;
    let { username } = request;
    //GET USER ID
    const getUserId = `
            SELECT user_id
                FROM user
            WHERE 
                username='${username}';`;
    const getUserIdResponse = await db.get(getUserId);

    //GET USER FOLLOWING ID'S
    const getFollowingIdsQuery = `
    SELECT following_user_id
        FROM follower
    WHERE follower_user_id=${getUserIdResponse.user_id};`;
    const getFollowingIdsArr = await db.all(getFollowingIdsQuery);
    const getFollowingEachIds = getFollowingIdsArr.map((eachId) => {
      return eachId.following_user_id;
    });

    //CHECK TWEET MADE MY PERSON HE IS FOLLOWING
    const getTweetIdsQuery = `
    SELECT tweet_id
        FROM tweet
    WHERE user_id in (${getFollowingEachIds})`;
    const tweetsIdResponseArr = await db.all(getTweetIdsQuery);
    const getTweetId = tweetsIdResponseArr.map((eachTweet) => {
      return eachTweet.tweet_id;
    });
    if (getTweetId.includes(parseInt(tweetId))) {
      const getUserReplyTweetsQuery = `
        SELECT user.name, reply.reply
            FROM user INNER JOIN reply ON user.user_id=reply.user_id
        WHERE reply.tweet_id=${tweetId};`;
      const getUserReplyResponse = await db.all(getUserReplyTweetsQuery);

      response.send(userReplyToObject(getUserReplyResponse));
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API-9
//Returns a list of all tweets of the user
app.get("/user/tweets/", tokenAuthentication, async (request, response) => {
  let { username } = request;
  //GET USER ID
  const getUserIdQuery = `
    SELECT user_id
        FROM user
    WHERE username='${username}';`;
  const getUserIdResponse = await db.get(getUserIdQuery);
  const getTweetsIdOfUser = `
    SELECT tweet_id
        FROM tweet
    WHERE
        user_id=${getUserIdResponse.user_id};`;
  const getTweetsOfUserResponse = await db.all(getTweetsIdOfUser);
  //
  const getEachTweetsObj = getTweetsOfUserResponse.map((eachId) => {
    return eachId.tweet_id;
  });
  //GET TWEETS OF THE USER
  const getUserTweetsQuery = `
   SELECT 
   tweet,
   (
       SELECT COUNT(like_id)
       FROM like
       WHERE tweet_id=tweet.tweet_id
   ) AS likes,
   (
       SELECT COUNT(reply_id)
       FROM reply
       WHERE tweet_id=tweet.tweet_id
   ) AS replies,
   date_time AS dateTime
   FROM tweet
   WHERE user_id= ${getUserIdResponse.user_id}`;
  const getUserTweetsResponse = await db.all(getUserTweetsQuery);
  //   console.log(getUserTweetsQuery);
  response.send(getUserTweetsResponse);
});

//API-10
//Create a tweet in the tweet table
app.post("/user/tweets/", tokenAuthentication, async (request, response) => {
  let { username } = request;
  const { tweet } = request.body;

  const getUserId = `
    SELECT user_id
        FROM user
    WHERE username='${username}';`;
  const getUserIdResponse = await db.get(getUserId);
  console.log(getUserIdResponse);

  const currentDate = new Date();

  const postTweetQuery = `
  INSERT INTO tweet(tweet, user_id, date_time)
  VALUES ("${tweet}", ${getUserIdResponse.user_id}, '${currentDate}');`;
  //POSTING NEW TWEET
  const postTweetResponse = await db.run(postTweetQuery);
  const tweet_id = postTweetResponse.lastID;
  response.send("Created a Tweet");
});

//API-11
//DELETE TWEET POSTED
app.delete(
  "/tweets/:tweetId/",
  tokenAuthentication,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    //get user id
    const getUserIdQuery = `
    SELECT user_id
        FROM user
    WHERE username='${username}';`;
    const getUserIdResponse = await db.get(getUserIdQuery);

    const getUserTweetsQuery = `
    SELECT tweet_id
        FROM tweet
    WHERE user_id=${getUserIdResponse.user_id};`;
    const getUserTweetsResponseArr = await db.all(getUserTweetsQuery);
    // console.log(getUserTweetsResponseArr);
    const getUserTweetsEach = getUserTweetsResponseArr.map((eachTweet) => {
      return eachTweet.tweet_id;
    });
    // console.log(getUserTweetsEach)
    if (getUserTweetsEach.includes(parseInt(tweetId))) {
      console.log(tweetId);
      const deleteUserTweetQuery = `
        DELETE FROM tweet
            WHERE tweet_id=${tweetId};`;
      await db.run(deleteUserTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
