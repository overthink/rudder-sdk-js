import Emitter from 'component-emitter';
import { generateUUID } from '@rudderstack/analytics-js/components/utilities/uuId';
import { GenericObject } from '@rudderstack/analytics-js/types';
import { Store } from '@rudderstack/analytics-js/services/StorageManager/Store';
import { Schedule, ScheduleModes } from './Schedule';
import { QueueStatuses } from './QueueStatuses';

export interface QueueOptions {
  maxItems?: number;
  maxAttempts?: number;
  minRetryDelay?: number;
  maxRetryDelay?: number;
  backoffFactor?: number;
  backoffJitter?: number;
}

export type QueueBackoff = {
  MIN_RETRY_DELAY: number;
  MAX_RETRY_DELAY: number;
  FACTOR: number;
  JITTER: number;
};

export type QueueTimeouts = {
  ACK_TIMER: number;
  RECLAIM_TIMER: number;
  RECLAIM_TIMEOUT: number;
  RECLAIM_WAIT: number;
};

export type QueueItem = {
  item: GenericObject | string | number;
  attemptNumber: number;
  time: number;
  id: string;
};

export type InProgressQueueItem = {
  item: GenericObject | string | number;
  done: QueueProcessCallback;
};

export type QueueItemData = GenericObject | string | number;

/**
 * @callback processFunc
 * @param {any} item The item added to the queue to process
 * @param {Function} done A function to call when processing is completed.
 *   @param {Error} Optional error parameter if the processing failed
 *   @param {Response} Optional response parameter to emit for async handling
 */
export type QueueProcessCallback = (item: any, done: (error?: any, response?: any) => void) => void;

const sortByTime = (a: QueueItem, b: QueueItem) => a.time - b.time;

/**
 * Constructs a Queue backed by localStorage
 *
 * @constructor
 * @param {String} name The name of the queue. Will be used to find abandoned queues and retry their items
 * @param {Object} [opts] Optional argument to override `maxItems`, `maxAttempts`, `minRetryDelay, `maxRetryDelay`, `backoffFactor` and `backoffJitter`.
 * @param {QueueProcessCallback} fn The function to call in order to process an item added to the queue
 */
class Queue extends Emitter {
  name: string;
  id: string;
  fn: QueueProcessCallback;
  maxItems: number;
  maxAttempts: number;
  backoff: QueueBackoff;
  timeouts: QueueTimeouts;
  schedule: Schedule;
  processId: string;
  store: Store;
  running: boolean;

  constructor(name: string, opts: QueueOptions | QueueProcessCallback, fn?: QueueProcessCallback) {
    super();

    let queueProcessCb = fn;
    let options: QueueOptions = {};

    // TODO: is this used anywhere? If not remove the arguments override and enforce 3 arguments
    // Allow arguments override
    if (typeof opts === 'function') {
      queueProcessCb = opts as QueueProcessCallback;
    } else {
      options = opts as QueueOptions;
    }

    this.name = name;
    this.id = generateUUID();
    this.fn = queueProcessCb as QueueProcessCallback;
    this.maxItems = options.maxItems || Infinity;
    this.maxAttempts = options.maxAttempts || Infinity;

    this.backoff = {
      MIN_RETRY_DELAY: options.minRetryDelay || 1000,
      MAX_RETRY_DELAY: options.maxRetryDelay || 30000,
      FACTOR: options.backoffFactor || 2,
      JITTER: options.backoffJitter || 0,
    };

    // painstakingly tuned. that's why they're not "easily" configurable
    this.timeouts = {
      ACK_TIMER: 1000,
      RECLAIM_TIMER: 3000,
      RECLAIM_TIMEOUT: 10000,
      RECLAIM_WAIT: 500,
    };

    this.schedule = new Schedule();
    this.processId = '0';

    // Set up our empty queues
    this.store = new Store(this.name, this.id, QueueStatuses);
    this.store.set(QueueStatuses.IN_PROGRESS, {});
    this.store.set(QueueStatuses.QUEUE, []);

    // bind recurring tasks for ease of use
    this.ack = this.ack.bind(this);
    this.checkReclaim = this.checkReclaim.bind(this);
    this.processHead = this.processHead.bind(this);

    this.running = false;
  }

  /**
   * Stops processing the queue
   */
  stop() {
    this.schedule.cancelAll();
    this.running = false;
  }

  /**
   * Starts processing the queue
   */
  start() {
    if (this.running) {
      this.stop();
    }

    this.running = true;
    this.ack();
    this.checkReclaim();
    this.processHead();
  }

  /**
   * Decides whether to retry. Overridable.
   *
   * @param {Object} item The item being processed
   * @param {Number} attemptNumber The attemptNumber (1 for first retry)
   * @return {Boolean} Whether to requeue the message
   */
  shouldRetry(item: QueueItemData, attemptNumber: number): boolean {
    return attemptNumber <= this.maxAttempts;
  }

  /**
   * Calculates the delay (in ms) for a retry attempt
   *
   * @param {Number} attemptNumber The attemptNumber (1 for first retry)
   * @return {Number} The delay in milliseconds to wait before attempting a retry
   */
  getDelay(attemptNumber: number): number {
    let ms = this.backoff.MIN_RETRY_DELAY * this.backoff.FACTOR ** attemptNumber;

    if (this.backoff.JITTER) {
      const rand = Math.random();
      const deviation = Math.floor(rand * this.backoff.JITTER * ms);

      if (Math.floor(rand * 10) < 5) {
        ms = ms - deviation;
      } else {
        ms = ms + deviation;
      }
    }

    return Number(Math.min(ms, this.backoff.MAX_RETRY_DELAY).toPrecision(1));
  }

  enqueue(entry: QueueItem) {
    let queue = this.store.get(QueueStatuses.QUEUE) || [];

    queue = queue.slice(-(this.maxItems - 1));
    queue.push(entry);
    queue = queue.sort(sortByTime);

    this.store.set(QueueStatuses.QUEUE, queue);

    if (this.running) {
      this.processHead();
    }
  }

  /**
   * Adds an item to the queue
   *
   * @param {Object} item The item to process
   */
  addItem(item: QueueItemData) {
    this.enqueue({
      item,
      attemptNumber: 0,
      time: this.schedule.now(),
      id: generateUUID(),
    });
  }

  /**
   * Adds an item to the retry queue
   *
   * @param {Object} item The item to retry
   * @param {Number} attemptNumber The attempt number (1 for first retry)
   * @param {Error} [error] The error from previous attempt, if there was one
   * @param {String} [id] The id of the queued message used for tracking duplicate entries
   */
  requeue(item: QueueItemData, attemptNumber: number, error?: Error, id?: string) {
    if (this.shouldRetry(item, attemptNumber)) {
      this.enqueue({
        item,
        attemptNumber,
        time: this.schedule.now() + this.getDelay(attemptNumber),
        id: id || generateUUID(),
      });
    } else {
      this.emit('discard', item, attemptNumber);
    }
  }

  processHead() {
    // cancel the scheduled task if it exists
    this.schedule.cancel(this.processId);

    // Pop the head off the queue
    let queue = this.store.get(QueueStatuses.QUEUE) || [];
    const inProgress = this.store.get(QueueStatuses.IN_PROGRESS) || {};
    const now = this.schedule.now();
    const toRun: InProgressQueueItem[] = [];
    // TODO: fix the type for the processItemCallback generated function
    const processItemCallback = (el: QueueItem, id: string) => (err?: Error, res?: any) => {
      const inProgress = this.store.get(QueueStatuses.IN_PROGRESS) || {};
      delete inProgress[id];

      this.store.set(QueueStatuses.IN_PROGRESS, inProgress);
      this.emit('processed', err, res, el.item);

      if (err) {
        this.requeue(el.item, el.attemptNumber + 1, err, el.id);
      }
    };
    const enqueueItem = (el: QueueItem, id: string) => {
      toRun.push({
        item: el.item,
        done: processItemCallback(el, id),
      });
    };

    let inProgressSize = Object.keys(inProgress).length;

    // eslint-disable-next-line no-plusplus
    while (queue.length > 0 && queue[0].time <= now && inProgressSize++ < this.maxItems) {
      const el = queue.shift();
      const id = generateUUID();

      // Save this to the in progress map
      inProgress[id] = {
        item: el.item,
        attemptNumber: el.attemptNumber,
        time: this.schedule.now(),
      };

      enqueueItem(el, id);
    }

    this.store.set(QueueStatuses.QUEUE, queue);
    this.store.set(QueueStatuses.IN_PROGRESS, inProgress);

    toRun.forEach(el => {
      // TODO: handle fn timeout
      try {
        this.fn(el.item, el.done);
      } catch (err) {
        console.error(`error: Process function threw error: ${err}`);
      }
    });

    // re-read the queue in case the process function finished immediately or added another item
    queue = this.store.get(QueueStatuses.QUEUE) || [];
    this.schedule.cancel(this.processId);

    if (queue.length > 0) {
      const nextProcessExecutionTime = queue[0].time - now;
      this.processId = this.schedule.run(
        this.processHead,
        nextProcessExecutionTime,
        ScheduleModes.ASAP,
      );
    }
  }

  // Ack continuously to prevent other tabs from claiming our queue
  ack() {
    this.store.set(QueueStatuses.ACK, this.schedule.now());
    this.store.set(QueueStatuses.RECLAIM_START, null);
    this.store.set(QueueStatuses.RECLAIM_END, null);
    this.schedule.run(this.ack, this.timeouts.ACK_TIMER, ScheduleModes.ASAP);
  }

  reclaim(id: string) {
    const other = new Store(this.name, id, QueueStatuses);
    const our = {
      queue: (this.store.get(QueueStatuses.QUEUE) || []) as QueueItem[],
    };
    const their = {
      inProgress: other.get(QueueStatuses.IN_PROGRESS) || {},
      queue: (other.get(QueueStatuses.QUEUE) || []) as QueueItem[],
    };
    const trackMessageIds: string[] = [];

    const addConcatQueue = (
      queue: QueueItem[] | GenericObject | null,
      incrementAttemptNumberBy: number,
    ) => {
      const concatIterator = (el: QueueItem | GenericObject) => {
        const id = el.id || generateUUID();

        if (trackMessageIds.includes(id)) {
          this.emit('duplication', el.item, el.attemptNumber);
        } else {
          our.queue.push({
            item: el.item,
            attemptNumber: el.attemptNumber + incrementAttemptNumberBy,
            time: this.schedule.now(),
            id,
          });
          trackMessageIds.push(id);
        }
      };

      if (Array.isArray(queue)) {
        queue.forEach(concatIterator);
      } else if (queue) {
        Object.values(queue).forEach(concatIterator);
      }
    };

    // add their queue to ours, resetting run-time to immediate and copying the attempt#
    addConcatQueue(their.queue, 0);

    // if the queue is abandoned, all the in-progress are failed. retry them immediately and increment the attempt#
    addConcatQueue(their.inProgress, 1);

    our.queue = our.queue.sort(sortByTime);

    this.store.set(QueueStatuses.QUEUE, our.queue);

    // remove all keys
    other.remove(QueueStatuses.IN_PROGRESS);
    other.remove(QueueStatuses.QUEUE);
    other.remove(QueueStatuses.RECLAIM_START);
    other.remove(QueueStatuses.RECLAIM_END);
    other.remove(QueueStatuses.ACK);

    // process the new items we claimed
    this.processHead();
  }

  checkReclaim() {
    const createReclaimStartTask = (store: Store) => () => {
      if (store.get(QueueStatuses.RECLAIM_END) !== this.id) {
        return;
      }

      if (store.get(QueueStatuses.RECLAIM_START) !== this.id) {
        return;
      }

      this.reclaim(store.id);
    };
    const createReclaimEndTask = (store: Store) => () => {
      if (store.get(QueueStatuses.RECLAIM_START) !== this.id) {
        return;
      }

      store.set(QueueStatuses.RECLAIM_END, this.id);

      this.schedule.run(
        createReclaimStartTask(store),
        this.timeouts.RECLAIM_WAIT,
        ScheduleModes.ABANDON,
      );
    };
    const tryReclaim = (store: Store) => {
      store.set(QueueStatuses.RECLAIM_START, this.id);
      store.set(QueueStatuses.ACK, this.schedule.now());

      this.schedule.run(
        createReclaimEndTask(store),
        this.timeouts.RECLAIM_WAIT,
        ScheduleModes.ABANDON,
      );
    };
    const findOtherQueues = (name: string): Store[] => {
      const res: Store[] = [];
      const storage = this.store.getOriginalEngine();

      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        const parts: string[] = k ? k.split('.') : [];

        if (parts.length !== 3) {
          // eslint-disable-next-line no-continue
          continue;
        }

        if (parts[0] !== name) {
          // eslint-disable-next-line no-continue
          continue;
        }

        if (parts[2] !== QueueStatuses.ACK) {
          // eslint-disable-next-line no-continue
          continue;
        }

        res.push(new Store(name, parts[1], QueueStatuses));
      }

      return res;
    };

    findOtherQueues(this.name).forEach(store => {
      if (store.id === this.id) {
        return;
      }

      if (this.schedule.now() - store.get(QueueStatuses.ACK) < this.timeouts.RECLAIM_TIMEOUT) {
        return;
      }

      tryReclaim(store);
    });

    this.schedule.run(this.checkReclaim, this.timeouts.RECLAIM_TIMER, ScheduleModes.RESCHEDULE);
  }
}

/**
 * Mix in event emitter
 */
Emitter(Queue);

// TODO: see if we can get rid of the Emitter
export { Queue };