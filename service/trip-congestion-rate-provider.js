'use strict';

const tripPastStopsProvider = require('./trip-past-stops-provider');
const loadDurationProvider = require('./load-duration-provider');
const tripRepository = require('./trip-repository');
const InvalidStateError = require('../error/invalid-state');
const NoSuchEntityError = require('../error/no-such-entity');

module.exports = {
    /**
     * Returns a live congestion rate (0 to 1) for a trip.
     *
     * @param {String} tripId
     * @returns {Promise<number>}
     * @throws InvalidStateError - if no weighted average load duration available
     */
    async getCongestionRate(tripId) {
        const loadDurations = await getLoadDurations(tripId);

        const weightedLoadDuration = loadDurations
            .reduce((acc, loadDurations, idx, arr) => {
                const [tripLoadDurationForStop] = loadDurations;

                return acc + tripLoadDurationForStop * getLoadDurationWeight(idx, arr);
            }, 0);

        const weightedAverageLoadDuration = loadDurations
            .reduce((acc, loadDurations, idx, arr) => {
                const [, averageLoadDurationForStop] = loadDurations;

                return acc + averageLoadDurationForStop * getLoadDurationWeight(idx, arr);
            }, 0);

        if (!weightedAverageLoadDuration) {
            throw new InvalidStateError(
                'Weighted average load duration for the trip doesn\'t exist, so the congestion rate cannot be calculated.'
            );
        }

        return weightedLoadDuration / weightedAverageLoadDuration;
    },
};

/**
 * Get stop load durations in seconds for trip,
 * sorted by chronological order (eg. 1st stop on route is 1st in array)
 *
 * @param {String} tripId
 * @returns {Array<Array<Number, Number>>}
 */
async function getLoadDurations(tripId) {
    try {
        const [trip, stopsBeenTo] = await Promise.all([
            tripRepository.getById(tripId),
            tripPastStopsProvider.getList(tripId),
        ]);

        return await Promise.all(
            stopsBeenTo.map(stop => Promise.all([
                loadDurationProvider.getByTrip(stop.id, tripId),
                loadDurationProvider.getAverageByRoutePattern(stop.id, trip.routePatternId),
            ]))
        );
    } catch (e) {
        // NoSuchEntityError is thrown if trip isn't yet recorded, which is ok.
        if (!(e instanceof NoSuchEntityError)) {
            console.error(e);
        }

        return [];
    }
}

/**
 * The weight (eg. relevance) of the stop duration
 * decreases the further away into the past it goes
 * (with the rate of 1/x)
 *
 * @param {Number} idx
 * @param {Array<Array<Number, Number>>} allDurations - ordered from first to last stop
 * @returns {Number}
 */
function getLoadDurationWeight(idx, allDurations) {
    return 1 / (allDurations.length - idx);
}
