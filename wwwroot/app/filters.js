angular
    .module('uRuns')
    .filter('unique', function () {
        return function (collection, keyname) {
            var output = [],
                keys = [];

            angular.forEach(collection, function (item) {
                var key = item[keyname];
                if (keys.indexOf(key) === -1) {
                    keys.push(key);
                    output.push(item);
                }
            });

            return output;
        };
    })
    .filter('urlFix', function () {
        return function ($url) {

            var tarea_regex = /(http(s?))\:\/\//gi;
            if (!tarea_regex.test($url)) {
                $url = "http://" + $url;
            }

            return $url;

        };
    })
    .filter('getByAttr', function () {
        return function (input, val, attr) {
            if (attr === undefined) {
                for (var k in input) {
                    if (k == val) {
                        return input[k];
                    }
                }
            } else {
                var i = 0, len = input.length;
                for (; i < len; i++) {
                    if (+input[i][attr] == +val) {
                        return input[i];
                    }
                }
            }
            return null;
        }
    }).filter('switch', function () {
        return function (input, map) {
            return map[input] || '';
        };
    }).filter('selectedToTop', function () {
        return function (contacts, selected) {
            var newList = [];
            angular.forEach(contacts, function (u) {
                if (u.id == selected) {
                    newList.unshift(u);
                }
                else {
                    newList.push(u);
                }
            });
            return newList;
        };
    });