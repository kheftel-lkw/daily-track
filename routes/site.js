// SITE ROUTER /////////////////////////////
const express = require('express');
const mongoose = require('mongoose');
const Dataset = require('../models/dataset');
const Datapoint = require('../models/datapoint');
const User = require('../models/user');
const passport = require('passport');
const _ = require('lodash');
const moment = require('moment');
const createError = require('http-errors');
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn;
const ensureLoggedOut = require('connect-ensure-login').ensureLoggedOut;

const set_controller = require('../controllers/datasetController');

const siteRouter = express.Router();

// template data
var state = {
    siteTitle: 'DailyTrack',
    nav: [{
            title: 'Overview',
            icon: 'fa-list',
            path: '/',
            acl: 'loggedIn'
        },
        {
            title: 'New Dataset',
            icon: 'fa-plus-square',
            path: '/set/new',
            noscroll: true,
            acl: 'loggedIn',
            parent: '/'
        },
        {
            title: 'Multi-View',
            icon: 'fa-chart-pie',
            path: '/multi',
            noscroll: true,
            acl: 'loggedIn'
        },
        {
            title: 'Log Out ${USERNAME}',
            path: '/logout',
            icon: 'fa-sign-out-alt',
            acl: 'loggedIn'
        },
        {
            title: 'Sign Up',
            path: '/register',
            // nolink: true,
            acl: 'loggedOut'
        },
        {
            title: 'Log In',
            path: '/login',
            // nolink: true,
            acl: 'loggedOut'
        }
    ],
    dynamic: [{
            regex: /^\/set\/.+\/edit/, //match /set/id/edit
            title: 'Edit ${DATASET_NAME}',
            icon: '',
            noscroll: true,
            acl: 'loggedIn',
            parent: /^\/set\/.+/
        }, {
            regex: /^\/set\/.+/, //match /set/id
            title: '${DATASET_NAME}',
            notitle: true,
            icon: '',
            noscroll: true,
            acl: 'loggedIn',
            parent: '/'
        },
        {
            regex: /^\/multi\/.+/, //match /multi/:label
            title: '${DATASET_UNIT}',
            notitle: true,
            icon: '',
            noscroll: true,
            acl: 'loggedIn',
            parent: '/multi'
        }
    ],
    style: {
        chartRowHeight: '320px'
    }
};

// prep state
siteRouter.use(function (req, res, next) {
    console.log('initialization: ' + req.path);

    // configure template locals
    // site title
    res.locals.siteTitle = state.siteTitle;
    // nav - note it's a copy for string replacement
    res.locals.nav = preProcessNav(req);
    // style - not sure if still used
    res.locals.style = state.style;
    // give the template a subset of the req object
    res.locals.req = {
        path: req.path
    };
    // pass along the logged in user if any
    res.locals.user = req.user;

    // grab current page from nav
    let active = _.find(state.nav, {
        path: req.path
    });
    if (!active) {
        // match dynamic pages
        state.dynamic.some((v, k, col) => {
            console.log(`testing ${req.path} vs ${v.regex}`);
            if (v.regex && v.regex.test(req.path)) {
                // match!
                console.log('matched!');
                active = v;
                //break loop
                return true;
            }
        });
    }

    // process ACL
    if (active) {
        if (active.acl == 'loggedIn' && !req.isAuthenticated()) {
            if (req.path != '/')
                req.flash('error', 'You must log in first.');
            return res.redirect('/login');
        }
        if (active.acl == 'loggedOut' && req.isAuthenticated()) {
            return res.redirect('/');
        }

        // set template variables for active page
        res.locals.active = active;
        if (active.title)
            setPageTitle(res, active.title);

        var breadcrumbs = [];
        if (active.parent) {
            var parent = _.find(state.nav, {
                path: active.parent
            });
            // check dynamic pages - unfortunately this doesn't work cuz we can't process the title :/
            // if(!parent) {
            //     state.dynamic.some((v, k, col) => {
            //         if (active.parent instanceof RegExp && v.regex && v.regex.source == active.parent.source) {
            //             // match!
            //             parent = v;
            //             //break loop
            //             return true;
            //         }
            //     });
            // }
            if (parent) {
                breadcrumbs.push({
                    title: parent.title,
                    link: parent.path
                });
            }
        }
        // breadcrumbs.push({
        //     title: active.title
        // });
        if(breadcrumbs.length > 0)
            res.locals.breadcrumbs = breadcrumbs;
    }

    setFlashMessages(res, req.flash());

    // console.log('locals:');
    // console.log(res.locals);

    // pass some node module utility stuff along too!
    res.locals.moment = moment;

    next();
});

// show overview page
siteRouter.get('/', function (req, res, next) {
    Dataset.find({
            owner: req.user._id
        })
        .sort({
            name: 'asc'
        })
        .exec(function (err, datasets) {
            //to do: do something useful with error
            if (err)
                return next(err);

            res.locals.datasets = datasets;

            res.render('overview');
        });
});

// debug
siteRouter.get('/flash', function (req, res) {
    // Set a flash message by passing the key, followed by the value, to req.flash().
    req.flash('info', ['flash message 1', 'flash message 2']);
    req.flash('warning', ['flash message 1', 'flash message 2']);
    req.flash('error', ['flash message 1', 'flash message 2']);
    req.flash('success', ['flash message 1', 'flash message 2']);
    res.redirect('/');
});

// register
siteRouter.get('/register', function (req, res) {
    res.render('register');
});
siteRouter.get('/register/success', function (req, res) {
    req.flash('success', 'You have successfully registered, please log in.');
    res.redirect('/login');
});

// login
siteRouter.get('/login', function (req, res) {
    res.render('login');
});

siteRouter.post('/login',
    passport.authenticate('local', {
        failWithError: true,
        failureFlash: true
    }),
    function (req, res, next) {
        // handle success
        if (req.xhr) {
            return res.json({
                success: true,
                message: "Login successful for " + req.user.username
            });
        }
        req.flash('success', 'Welcome, ' + req.user.username + '!');
        return res.redirect('/');
    },
    function (err, req, res, next) {
        // handle error
        console.log('auth error');

        if (req.xhr) {
            // only call req.flash() here, because it consumes the messages
            var errorMessages = req.flash('error');
            console.log(errorMessages.join());
            return res.json({
                success: false,
                message: errorMessages.join(), // not sure if comma is correct
                passporterror: err
            });
        }
        return res.redirect('/login');
    }
);

// siteRouter.post('/login', passport.authenticate('local', {
//     failureRedirect: '/login',
//     failureFlash: true
// }), function (req, res) {
//     if (req.user)
//         req.flash('success', 'Welcome, ' + req.user.username + '!');
//     res.redirect('/');
// });

// logout
siteRouter.get('/logout', function (req, res) {
    req.logout();
    if (req.xhr) {
        return res.json({
            success: true,
            message: 'You have been logged out'
        });
    }
    return res.redirect('/');
});

// deprecated: all dataset detail views on one page
siteRouter.get('/datasets', function (req, res, next) {
    Dataset.find()
        .sort({
            name: 'asc'
        })
        .exec(function (err, datasets) {
            //to do: do something useful with error
            if (err)
                return next(err);

            res.locals.datasets = datasets;

            // today's date
            res.locals.defaults = {
                x: moment().format('YYYY-MM-DD')
            };

            res.render('datasets');
        });
});

// new dataset
siteRouter.get('/set/new', function (req, res, next) {
    res.render('set_form');
});

// view dataset
siteRouter.get('/set/:id', function (req, res, next) {

    // grab the dataset from the db
    Dataset.findById(req.params.id, function (err, dataset) {
        if (err)
            return next(err);

        if (!dataset) {
            console.log('no dataset found');

            // dataset not found
            return next(new Error('Dataset not found'));
        }

        // populate chart's datapoints
        Datapoint.find({
                'dataset': req.params.id,
            })
            .sort({
                x: 'asc'
            })
            .exec(function (err, datapoints) {
                if (err)
                    return next(err);

                var result = dataset.toObject();
                result.data = datapoints;
                res.locals.dataset = result;

                var title = replace_dataset_name(res.locals.active.title, dataset.name);
                setPageTitle(res, title);

                res.render('dataset');
            });
    });
});

// edit dataset
siteRouter.get('/set/:id/edit', function (req, res, next) {
    // grab the dataset from the db
    Dataset.findById(req.params.id, function (err, dataset) {
        if (err)
            return next(err);

        if (!dataset) {
            console.log('no dataset found');

            // dataset not found
            return next(new Error('Dataset not found'));
        }
        var result = dataset.toObject();
        res.locals.dataset = result;

        var title = replace_dataset_name(res.locals.active.title, dataset.name);
        setPageTitle(res, title);

        // we need custom breadcrumbs for this one lol, my code can't handle it
        res.locals.breadcrumbs = [
            {
                title: 'Overview',
                link: '/'
            },
            {
                title: dataset.name,
                link: '/set/' + req.params.id
            }
        ];

        res.render('set_form');
    });
});

// new data point on a dataset
// deprecated, new datapoint form is now modal
// siteRouter.get('/set/:id/new', function (req, res, next) {
//     console.log('new data point form');

//     // grab the dataset from the db
//     Dataset.findById(req.params.id, function (err, dataset) {
//         if (err)
//             return next(err);

//         if (!dataset) {
//             console.log('no dataset found');

//             // dataset not found
//             return next('Dataset not found');
//         }

//         var result = dataset.toObject();
//         res.locals.dataset = result;

//         var active = {
//             title: dataset.name + ': add entry',
//             noscroll: true
//         };
//         res.locals.active = active;
//         setPageTitle(res, active.title);

//         // today's date
//         res.locals.defaults = {
//             x: moment().format('YYYY-MM-DD')
//         };

//         res.render('point_form');
//     });
// });

// view multiple datasets on the same chart
siteRouter.get('/multi', function (req, res, next) {
    Dataset.find({
            owner: req.user._id
        })
        .sort({
            name: 'asc',
        })
        .exec(function (err, datasets) {
            //to do: do something useful with error
            if (err)
                return next(error);

            // compute a list of unique units
            var uniqueLabels = [];
            for (let i = 0; i < datasets.length; i++) {
                if (uniqueLabels.indexOf(datasets[i].yAxisLabel) < 0)
                    uniqueLabels.push(datasets[i].yAxisLabel);
            }

            res.locals.labels = uniqueLabels;
            res.render('multi');
        });
});
siteRouter.get('/multi/:label', function (req, res, next) {
    Dataset.find({
            owner: req.user._id,
            yAxisLabel: req.params.label
        })
        .sort({
            name: 'asc',
        })
        .exec(function (err, datasets) {
            //to do: do something useful with error
            if (err)
                return next(error);

            // var filteredSets = [];
            // for (let i = 0; i < datasets.length; i++) {
            //     console.log(datasets[i]);
            //     if (datasets[i].yAxisLabel == '1-10 scale')
            //         filteredSets.push(datasets[i]);
            // }

            res.locals.datasets = datasets;

            console.log(res.locals.active.title);
            setPageTitle(res, replace_dataset_unit(res.locals.active.title, req.params.label));

            res.render('multi');
        });
});

// catch 404 and forward to error handler
siteRouter.use(function (req, res, next) {
    next(createError(404));
});

// error handler
siteRouter.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    res.locals.siteTitle = 'DailyTrack - Error';
    res.locals.pageTitle = 'Error';

    var active = {
        noscroll: true
    };

    res.locals.active = active;
    res.locals.nav = [];

    // render the error page
    err.status = err.status || 500;
    res.status(err.status || 500);
    res.render('error');
});

// helper functions ///////////////////

/**
 * add page title to res.locals
 * @param {*} res 
 * @param {*} title 
 */
function setPageTitle(res, title) {
    res.locals.pageTitle = title;
    res.locals.siteTitle = state.siteTitle + ' - ' + title;
}

function replace_dataset_unit(str, label) {
    str = str.replace('${DATASET_UNIT}', label ? label : '');
    return str;
}

function replace_dataset_name(str, name) {
    str = str.replace('${DATASET_NAME}', name ? name : '');
    return str;
}

/**
 * add flash messages to res.locals
 */
function setFlashMessages(res, messages) {
    // add flash messages to locals, rewrite passport's "error" to "danger" for bootstrap classes
    res.locals.messages = {};
    for (var k in messages) {
        res.locals.messages[k == 'error' ? 'danger' : k] = messages[k];
    }
    if (!_.isEmpty(res.locals.messages))
        console.log(res.locals.messages);
}

/**
 * preprocess the nav object, do string replacement etc
 */
function preProcessNav(req) {
    var retval = [];
    for (let i = 0; i < state.nav.length; i++) {
        let current = JSON.parse(JSON.stringify(state.nav[i]));

        // determine whether to include this link
        if (typeof current.acl === 'undefined' ||
            (current.acl == 'loggedIn' && req.isAuthenticated()) ||
            (current.acl == 'loggedOut' && !req.isAuthenticated())
        ) {
            // do some string replacements
            current.title = current.title.replace('${USERNAME}', req.user ? req.user.username : '');

            retval.push(current);
        }
    }

    return retval;
}

// router.post('/set/create', set_controller.create_post);
// router.get('/set/:id/delete', set_controller.delete_get);
// router.post('/set/:id/delete', set_controller.delete_post);
// router.get('/set/:id/update', set_controller.update_get);
// router.post('/set/:id/update', set_controller.update_post);
// router.get('/set/:id', set_controller.detail);
// router.get('/sets', set_controller.list);

module.exports = siteRouter;