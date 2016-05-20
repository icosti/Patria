/*jshint camelcase: false */
var fs = require('fs');
var path = require('path');

var S = require('string');
var Twit = require('twit');

var redis = require('redis'),
    client = redis.createClient();

client.on('error', function(err) {
    console.log('Error ' + err);
});

var config = fs.existsSync('./local.config.js') ? require('./local.config.js') : require('./config.js');

var Twitter = new Twit(config.API);

var track = config.track;

if (config.media) {
    var b64media = fs.readFileSync(path.join(__dirname, config.media), {
        encoding: 'base64'
    });
}

var stream = Twitter.stream('statuses/filter', {
    track: track
});

var getPermalink = function(tweet) {
    return 'https://twitter.com/' + tweet.user.screen_name + '/status/' + tweet.id_str;
};

console.log(track);

stream.on('disconnect', function() {
    console.log('Disconnected from stream');
});

stream.on('limit', function() {
    console.log('Stream limited');
});

stream.on('tweet', function(tweet) {
    if (!tweet.retweeted_status && S(tweet.text.toLowerCase()).contains(track.toLowerCase())) {

        client.exists('@' + tweet.user.screen_name, function(error, exists) {
            if (error) {
                console.log(error);
            }

            if (!exists) {
                console.log('Pushing to queue:', getPermalink(tweet));

                client.rpush('queue', JSON.stringify({
                    name: tweet.user.screen_name,
                    id: tweet.id_str,
                    id_user: tweet.user.id_str
                }));

                client.set('@' + tweet.user.screen_name, '1');
                client.expire('@' + tweet.user.screen_name, 3600 * 24 * 7);
            } else {
                console.log('--');
                console.log('User blocked for 7 days');
                console.log('--');
            }
        });


    }
});


var tweet = function(t) {
    Twitter.post('media/upload', {
        media_data: b64media
    }, function(error, data) {
        if (error) {
            console.log(error);
        }

        var params = {
            status: '@' + t.name + ' voaremo, meu meniño',
            in_reply_to_status_id: t.id,
            media_ids: [data.media_id_string]
        };

        Twitter.post('statuses/update', params, function(error, data) {
            if (error) {
                console.log(error);
            }
            console.log('Done.');
        });
    });
};

var getNext = function() {
    client.lpop('queue', function(error, reply) {
        if (error) {
            console.log(error);
        }

        if (reply) {
            var currentTweet = JSON.parse(reply);

            console.log('Tweeting to ' + currentTweet.name);

            tweet(currentTweet);
        }
    });
};

setInterval(function() {
    client.llen('queue', function(error, size) {
        if (error) {
            console.log(error);
        }

        console.log('Queue size:', size);

        if (size) {
            getNext();
        } else {
            console.log('Queue empty.');
        }
    });
}, 1000 * 60 * 2);
