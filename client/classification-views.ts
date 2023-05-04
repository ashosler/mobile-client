import { getApiKey, getDeviceId, storeApiKey, storeDeviceId, getStudioEndpoint } from "./settings";
import { ISensor, ISamplingOptions } from "./sensors/isensor";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { MicrophoneSensor } from "./sensors/microphone";
import { CameraSensor } from "./sensors/camera";
import { Positional9DOFSensor } from "./sensors/9axisIMU";
import { ClassificationLoader } from "./classification-loader";
import { ClassificationResponse, ClassifierProperties, EdgeImpulseClassifier } from "./classifier";
import { Notify } from "./notify";
import { MovingAverageFilter } from "./moving-average-filter";
import { getErrorMsg } from "./utils";

export class ClassificationClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        selectSensor: document.querySelector('#permission-view') as HTMLElement,
        inferencing: document.querySelector('#inferencing-in-progress') as HTMLElement,
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        grantPermission: document.querySelector('#grant-permissions-button') as HTMLElement,
        inferencingSamplingBody: document.querySelector('#inferencing-sampling-body') as HTMLElement,
        inferencingTimeLeft: document.querySelector('#inferencing-time-left') as HTMLElement,
        inferencingMessage: document.querySelector('#inferencing-recording-data-message') as HTMLElement,
        inferencingResult: document.querySelector('#inferencing-result') as HTMLElement,
        inferencingResultTable: document.querySelector('#inferencing-result table') as HTMLElement,
        buildProgress: document.querySelector('#build-progress') as HTMLElement,
        inferenceCaptureBody: document.querySelector('#capture-camera') as HTMLElement,
        inferenceCaptureButton: document.querySelector('#capture-camera-button') as HTMLElement,
        inferenceRecordingMessageBody: document.querySelector('#inference-recording-message-body') as HTMLElement,
        switchToDataCollection: document.querySelector('#switch-to-data-collection') as HTMLAnchorElement,
        cameraInner: document.querySelector('.capture-camera-inner') as HTMLElement,
        cameraVideo: document.querySelector('.capture-camera-inner video') as HTMLVideoElement,
        cameraCanvas: document.querySelector('.capture-camera-inner canvas') as HTMLCanvasElement,
        showResults: document.querySelector('.show-results') as HTMLCanvasElement,
    };

    private _sensors: ISensor[] = [];
    private _classifier: EdgeImpulseClassifier | undefined;
    private _firstInference = true;
    private _inferenceCount = 0;
    private _isObjectDetection = false;
    private _colors = [
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#42d4f4', '#f032e6', '#fabed4',
        '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000', '#aaffc3',
    ];
    private _labelToColor: { [k: string]: string } = { };

    async init() {
        storeDeviceId(getDeviceId());

        const accelerometer = new AccelerometerSensor();
        if (await accelerometer.hasSensor()) {
            console.log('has accelerometer');
            this._sensors.push(accelerometer);
        }

        const microphone = new MicrophoneSensor();
        if (await microphone.hasSensor()) {
            console.log('has microphone');
            this._sensors.push(microphone);
        }

        const camera = new CameraSensor();
        if (await camera.hasSensor()) {
            console.log('has camera');
            this._sensors.push(camera);
        }

        const imu9DOF = new Positional9DOFSensor();
        if (await imu9DOF.hasSensor()) {
            console.log('has 9-axis positional sensors');
            this._sensors.push(imu9DOF);
        }

        if (window.location.search.indexOf('from=camera') > -1) {
            this._elements.switchToDataCollection.href = 'camera.html';
        }
        if (window.location.search.indexOf('from=microphone') > -1) {
            this._elements.switchToDataCollection.href = 'microphone.html';
        }
        if (window.location.search.indexOf('from=accelerometer') > -1) {
            this._elements.switchToDataCollection.href = 'accelerometer.html';
        }

        if (getApiKey()) {
            // persist keys now...
            storeApiKey(getApiKey());
            window.history.replaceState(null, '', window.location.pathname);

            this._elements.loadingText.textContent = 'Loading classifier...';

            // tslint:disable-next-line: no-floating-promises
            (async () => {
                let loader = new ClassificationLoader(getStudioEndpoint(), getApiKey());
                loader.on('status', msg => {
                    console.log('status', msg);
                    this._elements.loadingText.textContent = msg;
                });
                loader.on('buildProgress', progress => {
                    console.log('buildProgress', progress);
                    if (typeof progress === 'string') {
                        this._elements.buildProgress.style.display = 'block';
                        this._elements.buildProgress.textContent = progress || ' ';
                    }
                    else {
                        this._elements.buildProgress.style.display = 'none';
                    }
                });
                try {
                    this._classifier = await loader.load();
                    let props = this._classifier.getProperties();

                    if (props.sensor === 'microphone' && !(await microphone.hasSensor())) {
                        throw new Error('Model expects microphone, but device has none');
                    }
                    else if (props.sensor === 'accelerometer' && !(await accelerometer.hasSensor())) {
                        throw new Error('Model expects accelerometer, but device has none');
                    }
                    else if (props.sensor === 'camera' && !(await camera.hasSensor())) {
                        throw new Error('Model expects camera, but device has none');
                    }
                    else if (props.sensor === 'positional' && !(await imu9DOF.hasSensor())) {
                        throw new Error('Model expects positional sensors, but device has none');
                    }

                    if (props.sensor === 'accelerometer') {
                        this._elements.grantPermission.textContent = 'Give access to the accelerometer';
                    }
                    else if (props.sensor === 'microphone') {
                        this._elements.grantPermission.textContent = 'Give access to the microphone';
                    }
                    else if (props.sensor === 'camera') {
                        this._elements.grantPermission.textContent = 'Give access to the camera';
                    }
                    else if (props.sensor === 'positional') {
                        this._elements.grantPermission.textContent = 'Give access to the motion sensors';
                    }
                    else {
                        throw new Error('Unexpected sensor: ' + props.sensor);
                    }

                    let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === props.sensor);
                    if (sensor && await sensor.checkPermissions(false)) {
                        console.log('sensor checkPermissions OK');
                        this.grantPermission();
                    }
                    else {
                        this.switchView(this._views.selectSensor);
                    }
                }
                catch (ex) {
                    console.error('Failed to load', ex);
                    const errMsg = getErrorMsg(ex);
                    if (errMsg.indexOf('No deployment yet') > -1) {
                        this._elements.connectionFailedMessage.innerHTML = 'No deployment yet. Go to the ' +
                            '<strong>Deployment</strong> page in the Edge Impulse studio, ' +
                            'and deploy as WebAssembly.';
                    }
                    else {
                        this._elements.connectionFailedMessage.textContent = errMsg;
                    }

                    this.switchView(this._views.connectionFailed);
                }
                finally {
                    this._elements.buildProgress.style.display = 'none';
                }
            })();
        }
        else {
            this.switchView(this._views.qrcode);
        }

        this._elements.grantPermission.onclick = this.grantPermission.bind(this);
    }

    private switchView(view: HTMLElement) {
        for (const k of Object.keys(this._views)) {
            (<{ [k: string]: HTMLElement }>this._views)[k].style.display = 'none';
        }
        view.style.display = '';
    }

    private grantPermission() {
        if (!this._classifier) return;

        let prop = this._classifier.getProperties();
        let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === prop.sensor);
        if (!sensor) {
            this._elements.connectionFailedMessage.textContent = 'Could not find sensor ' + prop.sensor;
            this.switchView(this._views.connectionFailed);
            return;
        }

        sensor.checkPermissions(true).then(result => {
            if (result) {
                this.switchView(this._views.inferencing);

                console.log('prop', prop);

                if (prop.sensor === 'camera') {
                    this._elements.inferencingSamplingBody.style.display = 'none';
                    this._elements.inferenceCaptureBody.style.display = '';
                    this._elements.inferenceRecordingMessageBody.style.display = 'none';
                }
                else {
                    this._elements.inferencingSamplingBody.style.display = '';
                    this._elements.inferenceCaptureBody.style.display = 'none';
                    this._elements.inferenceRecordingMessageBody.style.display = '';
                }

                let sampleWindowLength = prop.inputFeaturesCount * (1000 / prop.frequency);
                this._elements.inferencingTimeLeft.textContent = 'Waiting';
                this._elements.inferencingMessage.textContent = 'Starting in 2 seconds...';

                const sampleNextWindow = async () => {
                    if (!sensor || !this._classifier) return;

                    this._elements.inferencingMessage.textContent = 'Sampling...';

                    let iv;
                    if (prop.sensor !== 'camera') {
                        let timeLeft = sampleWindowLength;
                        this._elements.inferencingTimeLeft.textContent = Math.round(timeLeft / 1000) + 's';
                        iv = setInterval(() => {
                            timeLeft -= 1000;
                            this._elements.inferencingTimeLeft.textContent = Math.round(timeLeft / 1000) + 's';
                        }, 1000);
                    }

                    try {
                        // clear out so it's clear we're inferencing
                        let samplingOptions: ISamplingOptions = { };
                        if (prop.sensor === 'camera') {
                            samplingOptions.mode = 'raw';
                            samplingOptions.inputWidth = prop.imageInputWidth;
                            samplingOptions.inputHeight = prop.imageInputHeight;
                        }
                        else {
                            samplingOptions.length = sampleWindowLength;
                            samplingOptions.frequency = prop.frequency ;
                        }

                        let data = await sensor.takeSample(samplingOptions);
                        if (iv) {
                            clearInterval(iv);
                        }

                        if (prop.sensor === 'camera') {
                            console.log('classification disable button');
                            this._elements.inferenceCaptureButton.innerHTML =
                                '<i class="fa fa-camera mr-2"></i>Inferencing...';
                            this._elements.inferenceCaptureButton.classList.add('disabled');

                            (<CameraSensor>sensor).pause();

                            if (this._isObjectDetection) {
                                for (let bx of Array.from(
                                    this._elements.cameraInner.querySelectorAll('.bounding-box-container'))
                                ) {
                                    bx.parentNode?.removeChild(bx);
                                }
                                await this.sleep(1);
                            }
                            else {
                                await this.sleep(1);
                            }
                        }
                        else {
                            // give some time to give the idea we're inferencing
                            this._elements.inferencingMessage.textContent = 'Inferencing...';
                            // await this.sleep(300);
                            await this.sleep(1000);
                        }

                        let d: number[];
                        if (data.values[0] instanceof Array) {
                            d = (<number[][]>data.values).reduce((curr, v) => curr.concat(v), []);
                        }
                        else {
                            d = <number[]>data.values;
                        }

                        // console.log('raw data', d.length, d);

                        console.time('inferencing');
                        let res = this._classifier.classify(d, false);
                        console.timeEnd('inferencing');

                        console.log('inference results', res);

                        await this.renderInferenceResults(res, prop, {
                            showNoObjectsFoundNotification: true,
                        });

                        if (prop.sensor === 'camera') {
                            console.log('classification enable button again');
                            this._elements.inferenceCaptureBody.style.display = 'initial';
                            this._elements.inferenceRecordingMessageBody.style.display = 'none';
                            this._elements.inferenceCaptureButton.classList.remove('disabled');
                            // this._elements.showResults.style.display = 'initial';
                            // this._elements.showResults.innerHTML =
                            //     '<i class="fa">TEST</i>';
                            this._elements.inferenceCaptureButton.innerHTML =
                                '<i class="fa fa-camera mr-2"></i>Next photo';

                            let onClick = async (ev: MouseEvent) => {
                                ev.preventDefault();
                                ev.stopImmediatePropagation();

                                this._elements.inferenceCaptureButton.removeEventListener('click', onClick);

                                let cameraSensor = (<CameraSensor>sensor);

                                if (cameraSensor.isPaused()) {
                                    for (let bx of Array.from(
                                        this._elements.cameraInner.querySelectorAll('.bounding-box-container'))) {

                                        bx.parentNode?.removeChild(bx);
                                    }

                                    this._elements.inferenceCaptureButton.innerHTML =
                                        '<i class="fa fa-camera mr-2"></i>Classify';
                                    await cameraSensor.resume();
                                }
                            };

                            this._elements.inferenceCaptureButton.addEventListener('click', onClick);

                            // immediately sample next window
                            // setTimeout(sampleNextWindow, 0);
                        }
                        else {
                            let startDelay = 2;
                            this._elements.inferenceCaptureBody.style.display = 'none';
                            this._elements.inferenceRecordingMessageBody.style.display = 'initial';
                            this._elements.inferencingTimeLeft.textContent = 'Waiting';
                            this._elements.inferencingMessage.textContent = `Starting in ${startDelay} seconds...`;
                            setTimeout(sampleNextWindow, startDelay * 1000);
                        }
                    }
                    catch (ex) {
                        clearInterval(iv);
                        console.error(ex);
                        this._elements.connectionFailedMessage.textContent = getErrorMsg(ex);
                        this.switchView(this._views.connectionFailed);
                    }
                };

                if (prop.sensor === 'camera') {
                    if (prop.modelType === 'object_detection') {
                        // MobileNet SSD should not run continuously (will be too slow)
                        setTimeout(sampleNextWindow, 1000000000000000);
                    }
                    else {
                        return this.sampleImagesContinuous(<CameraSensor>sensor, prop);
                    }
                }
                else if (prop.sensor === 'microphone' && sensor) {
                    return this.sampleAudioContinuous(sensor, prop);
                }
                else {
                    setTimeout(sampleNextWindow, 2000);
                }
            }
            else {
                alert('User has rejected ' + (prop.sensor) + ' permissions');
            }
        }).catch(err => {
            console.error(err);
            this._elements.connectionFailedMessage.textContent = err;
            this.switchView(this._views.connectionFailed);
        });
    }

    private sleep(ms: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    private async sampleAudioContinuous(sensor: ISensor, prop: ClassifierProperties) {
        if (!sensor || !this._classifier) return;
        if (prop.sensor !== 'microphone') {
            throw new Error('Sensor is not microphone, cannot do continuous audio sampling');
        }

        const sampleWindowLength = prop.inputFeaturesCount * (1000 / prop.frequency);

        document.body.classList.add('continuous-audio');
        this._elements.inferencingTimeLeft.textContent = 'Listening...';

        let isClassifying = false;
        let last = Date.now();
        // should be 250ms. but if not, make it align to window,
        // e.g. if 800ms. then we use 200ms.
        let sampleLength = 250 - (sampleWindowLength % 250);
        let maf: MovingAverageFilter | undefined;

        let lastFiveResults: string[] = [];

        const classify = async (data: number[]) => {
            try {
                if (!this._classifier) return;
                if (isClassifying) return; // avoid overload on slow devices

                isClassifying = true;

                console.log(Date.now() - last, 'data', data.length);
                last = Date.now();

                console.time('inferencing');
                let res = this._classifier.classify(data, false);
                console.timeEnd('inferencing');

                console.log('inference results', res);

                // Disabled: few-shot KWS does better on short words with MAF disabled

                // console.log('inference results before MAF', res);
                // if (!maf) {
                //     maf = new MovingAverageFilter(4, res.results.map(x => x.label));
                // }
                // res = maf.run(res);
                // console.log('inference results after MAF', res);

                await this.renderInferenceResults(res, prop, {
                    activeTimeout: sampleLength,
                    showNoObjectsFoundNotification: true
                });

                // if we have 3 classes (unknown/noise/XXX) then we only show something
                // when XXX is detected...
                let resKeys = res.results.map(x => x.label);
                if (resKeys.length === 3 && resKeys.indexOf('unknown') > -1 &&
                    resKeys.indexOf('noise') > -1) {

                    let keyword = resKeys.find(x => x !== 'noise' && x !== 'unknown');
                    let keywordRes = keyword ? res.results.find(x => x.label === keyword) : undefined;
                    if (keywordRes && keywordRes.value >= 0.8) {
                        lastFiveResults.push(keywordRes.label);
                    }
                    else {
                        lastFiveResults.push('...');
                    }

                    // saw the keyword in the last 5 results? then print it
                    if (lastFiveResults.length > 5) {
                        lastFiveResults = lastFiveResults.slice(1);
                    }

                    if (keywordRes && lastFiveResults.indexOf(keywordRes.label) > -1) {
                        this._elements.inferencingMessage.textContent = keywordRes.label;
                    }
                    else {
                        this._elements.inferencingMessage.textContent = '...';
                    }
                }
                // otherwise just print highest >= 0.8
                else {
                    let highest = res.results.find(x => x.value >= 0.8);
                    if (highest) {
                        this._elements.inferencingMessage.textContent = highest.label;
                    }
                    else {
                        this._elements.inferencingMessage.textContent = 'uncertain';
                    }
                }

                isClassifying = false;
            }
            catch (ex2) {
                let ex = <Error>ex2;
                this._elements.connectionFailedMessage.textContent = ex.message || ex.toString();
                this.switchView(this._views.connectionFailed);
            }
        };

        // tslint:disable-next-line: no-floating-promises
        (async () => {
            try {
                let allData: number[] = [];

                while (1) {
                    let samplingOptions: ISamplingOptions = {
                        length: sampleLength,
                        frequency: prop.frequency,
                        continuousMode: true
                    };
                    let data = await sensor.takeSample(samplingOptions);
                    let d = <number[]>data.values;
                    allData = allData.concat(d);
                    if (allData.length >= prop.inputFeaturesCount) {
                        // we do this in a setTimeout so we go read immediately again
                        setTimeout(() => {
                            // tslint:disable-next-line: no-floating-promises
                            classify(allData.slice(allData.length - prop.inputFeaturesCount));
                        }, 0);
                    }
                }
            }
            catch (ex2) {
                let ex = <Error>ex2;
                this._elements.connectionFailedMessage.textContent = ex.message || ex.toString();
                this.switchView(this._views.connectionFailed);
            }
        })();
    }

    private async sampleImagesContinuous(sensor: CameraSensor, prop: ClassifierProperties) {
        if (!this._classifier) return;

        while (1) {
            let samplingOptions: ISamplingOptions = {
                mode: 'raw',
                inputWidth: prop.imageInputWidth,
                inputHeight: prop.imageInputHeight,
            };

            // this._elements.inferenceCaptureButton.innerHTML =
            //     '<i class="fa fa-camera mr-2"></i>Inferencing...';
            // this._elements.inferenceCaptureButton.classList.add('disabled');

            let data = await sensor.takeSnapshot(samplingOptions);

            await this.sleep(1);

            let d: number[];
            if (data.values[0] instanceof Array) {
                d = (<number[][]>data.values).reduce((curr, v) => curr.concat(v), []);
            }
            else {
                d = <number[]>data.values;
            }

            // console.log('raw data', d.length, d);

            console.time('inferencing');
            let res = this._classifier.classify(d, false);
            console.timeEnd('inferencing');

            console.log('inference results', res);

            await this.renderInferenceResults(res, prop, {
                showNoObjectsFoundNotification: false,
            });

            console.log('prop.modelType', prop.modelType);

            if (prop.modelType === 'classification') {
                this._elements.inferenceRecordingMessageBody.style.display = '';
                this._elements.inferenceRecordingMessageBody.classList.remove('pt-0');
                this._elements.inferenceRecordingMessageBody.classList.add('pt-4');
                let highest = res.results.find(x => x.value >= 0.8);
                if (highest) {
                    this._elements.inferencingMessage.textContent = highest.label;
                }
                else {
                    this._elements.inferencingMessage.textContent = 'uncertain';
                }
            }
        }
    }

    private async renderInferenceResults(res: ClassificationResponse,
        prop: ClassifierProperties,
        opts: {
            activeTimeout?: number;
            showNoObjectsFoundNotification: boolean;
        }) {
        const activeTimeout = opts.activeTimeout || 1000;

        if (this._firstInference && res.results.length > 0) {
            this._firstInference = false;
            this._isObjectDetection = typeof res.results[0].x === 'number';

            if (!this._isObjectDetection) {
                this._elements.inferencingResult.style.visibility = '';

                let thead = <HTMLElement>
                    this._elements.inferencingResultTable.querySelector('thead tr');
                for (let e of res.results) {
                    let th = document.createElement('th');
                    th.scope = 'col';
                    th.textContent = e.label;
                    th.classList.add('px-0', 'text-center');
                    thead.appendChild(th);
                }
                if (res.anomaly !== 0.0) {
                    let th = document.createElement('th');
                    th.scope = 'col';
                    th.textContent = 'anomaly';
                    th.classList.add('px-0', 'text-center');
                    thead.appendChild(th);
                }

                if (thead.lastChild) {
                    (<HTMLElement>thead.lastChild).classList.add('pr-4');
                }
            }
        }

        if (!this._isObjectDetection && res.results.length > 0) {
            let tbody = <HTMLElement>this._elements.inferencingResultTable.querySelector('tbody');
            let row = document.createElement('tr');
            row.innerHTML = '<td class="pl-4 pr-0">' + (++this._inferenceCount) + '</td>';
            row.classList.add('active');

            setTimeout(() => {
                row.classList.remove('active');
            }, activeTimeout);

            for (let e of res.results) {
                let td = document.createElement('td');
                td.textContent = e.value.toFixed(2);
                td.classList.add('px-0', 'text-center');
                if (Math.max(...res.results.map(v => v.value)) === e.value) {
                    td.classList.add('font-weight-bold');
                }
                else {
                    td.classList.add('text-gray');
                }

                row.appendChild(td);
            }

            if (res.anomaly !== 0.0) {
                let td = document.createElement('td');
                td.textContent = res.anomaly.toFixed(2);
                td.classList.add('px-0', 'text-center');
                row.appendChild(td);
            }

            if (row.lastChild) {
                (<HTMLElement>row.lastChild).classList.add('pr-4');
            }

            if (tbody.childNodes.length === 0) {
                tbody.appendChild(row);
            }
            else {
                tbody.insertBefore(row, tbody.firstChild);
            }
        }
        //OBJECT DETECTION
        else {
            for (let bx of Array.from(
                this._elements.cameraInner.querySelectorAll('.bounding-box-container'))) {

                bx.parentNode?.removeChild(bx);
            }

            if (res.results.length === 0 && opts.showNoObjectsFoundNotification) {
                Notify.notify('', 'No objects found', 'top', 'center',
                    'fas fa-exclamation-triangle', 'success');
            }

            let heightFactor = Number(this._elements.cameraCanvas.height) /
                Number(this._elements.cameraVideo.clientHeight);

            let widthFactor = Number(this._elements.cameraCanvas.width) /
                Number(this._elements.cameraVideo.clientWidth);

            let tbody = <HTMLElement>this._elements.inferencingResultTable.querySelector('tbody');
            let head = document.createElement('tr');
            head.innerHTML = '<th style={"width: 33%"}>Label</th><th>X coord</th><th>Y coord</th>';
            head.classList.add('active');
            tbody.innerHTML = '';
            tbody.appendChild(head);

            let cx = -1;
            let cy = -1;
            let pocket_x: number[] = [];
            let pocket_y: number[]  = [];
            for (let e of res.results) {
                let row = document.createElement('tr');
                
                for (let txt of [e.label, e.x, e.y]) {
                    let td = document.createElement('td');
                    td.textContent = String(txt);
                    td.classList.add('px-0', 'text-center');
                    td.classList.add('text-gray');
                    row.appendChild(td);
                }
                if (e.label === "cue_ball") {
                    cx = Number(e.x);
                    cy = Number(e.y)
                }
                if (e.label === "pocket") {
                    pocket_x.push(Number(e.x));
                    pocket_y.push(Number(e.y));
                }
                tbody.appendChild(row);
            }

            let bestball_score = -1
            let bestx = -1
            let besty = -1
            if (cx != -1 && pocket_x.length > 0) {
                let score_head = document.createElement('tr');
                score_head.innerHTML = '<th>Coord</th><th>BestAngle</th><th>Score</th>';
                score_head.classList.add('active');
                // tbody.appendChild(score_head)

                // setTimeout(() => {
                //     score_head.classList.remove('active');
                // }, activeTimeout);

                for (let e of res.results) {
                    if (e.label === "pool_ball") {
                        let row = document.createElement('tr');
                        let coord_str = String(e.x)+','+String(e.y);
                        let best_angle = 0.0;
                        let best_score = -1000;

                        for (let i = 0; i < pocket_x.length; i++) {
                            let px = pocket_x[i];
                            let py = pocket_y[i];
                            
                            // let cue_ball_yx = [cx-Number(e.x), cy-Number(e.y)]
                            // let pocket_yx = [px-Number(e.x), py-Number(e.y)]

                            // let v1_xy = [cue_ball_yx[1], -1 * cue_ball_yx[0]]
                            // let v2_xy = [pocket_yx[1], -1 * pocket_yx[0]]

                            let AB = Math.sqrt(Math.pow(Number(e.x)-px,2)+ Math.pow(Number(e.y)-py,2));    
                            let BC = Math.sqrt(Math.pow(Number(e.x)-cx,2)+ Math.pow(Number(e.y)-cy,2)); 
                            let AC = Math.sqrt(Math.pow(cx-px,2)+ Math.pow(cy-py,2));
                            let cos = Math.acos((BC*BC+AB*AB-AC*AC)/(2*BC*AB));
                            let angle = Math.abs(cos * (180/Math.PI) - 180);
                            let shot_score = 180 - angle;

                            if (shot_score > best_score) {
                                best_angle = angle;
                                best_score = shot_score;
                            }
                            if (shot_score > bestball_score) {
                                bestball_score = shot_score
                                bestx = Number(e.x);
                                besty = Number(e.y);
                            }
                        }
                        
                        for (let txt of [coord_str,best_angle.toFixed(2),best_score.toFixed(2)]) {
                            let td = document.createElement('td');
                            td.textContent = txt;
                            td.classList.add('px-0', 'text-center');
                            td.classList.add('text-gray');
                            row.appendChild(td);
                        }
                        tbody.insertBefore(row, tbody.firstChild);
                        // tbody.appendChild(row);
                        
                        
                        
                    }
                }
                tbody.insertBefore(score_head, tbody.firstChild);
            }
            let num_blank_rows = 39 - tbody.childElementCount //39 = max rows for objects on a pool table
                for (let i = 0; i < num_blank_rows; i++) {
                    let row = document.createElement('tr');
                    for (let j = 0; j < 3; j++) {
                        let td = document.createElement('td');
                            td.textContent = "";
                            td.classList.add('px-0', 'text-center');
                            td.classList.add('text-gray');
                            row.appendChild(td);
                    }
                    tbody.appendChild(row);
                }
            
            for (let b of res.results) {
                if (typeof b.x !== 'number' ||
                    typeof b.y !== 'number' ||
                    typeof b.width !== 'number' ||
                    typeof b.height !== 'number') {
                    continue;
                }
                let bb = {
                    x: b.x / widthFactor,
                    y: b.y / heightFactor,
                    width: b.width / widthFactor,
                    height: b.height / heightFactor,
                    label: b.label,
                    value: b.value
                };

                if (!this._labelToColor[bb.label]) {
                    this._labelToColor[bb.label] = this._colors[0];
                    this._colors.splice(0, 1);
                }

                let color = this._labelToColor[bb.label];
                if (b.label === "pool_ball" && bestx === Number(b.x) && besty === Number(b.y)) {
                    color = '#0000ff';
                }

                let el = document.createElement('div');
                el.classList.add('bounding-box-container');
                el.style.position = 'absolute';
                el.style.border = 'solid 3px ' + color;

                if (prop.modelType === 'object_detection') {
                    el.style.width = (bb.width) + 'px';
                    el.style.height = (bb.height) + 'px';
                    el.style.left = (bb.x) + 'px';
                    el.style.top = (bb.y) + 'px';
                }
                else if (prop.modelType === 'constrained_object_detection') {
                    let centerX = bb.x + (bb.width / 2);
                    let centerY = bb.y + (bb.height / 2);

                    el.style.borderRadius = '10px';
                    el.style.width = 20 + 'px';
                    el.style.height = 20 + 'px';
                    el.style.left = (centerX - 10) + 'px';
                    el.style.top = (centerY - 10) + 'px';
                }

                let label = document.createElement('div');
                label.classList.add('bounding-box-label');
                label.style.background = color;
                label.textContent = bb.label + ' (' + bb.value.toFixed(2) + ')';
                if (prop.modelType === 'constrained_object_detection') {
                    el.style.whiteSpace = 'nowrap';
                }
                el.appendChild(label);

                this._elements.cameraInner.appendChild(el);
            }
        }
    }
}