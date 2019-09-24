const puppeteer = require("puppeteer");
const process = require("process");
const path = require("path");
const fs = require("fs");
const uuidv4 = require("uuid/v4");

require("events").EventEmitter.defaultMaxListeners = 30;

const assignment_title = "Benchmark";
const assignment_id = uuidv4();
const test_count = 5;
const browser_count = 1;

const url = "http://localhost:4000";

const launch_options = {
  headless: true,
  ignoreHTTPSErrors: true,
  args: ["--ignore-certificate-errors"]
};

function delay(timeout) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

const lti_launcher_url = `file:${path.join(__dirname, "../server/lti_launcher/index.html")}`;

(async () => {
  let browser = await puppeteer.launch(launch_options);
  const page = (await browser.pages())[0];

  page.on("dialog", async dialog => {
    await dialog.accept();
  });

  await page.goto(lti_launcher_url);

  // Make sure that the Autocheck page opens in a new tab.
  // I can't imagine how cumbersome it would be to work with an iframe in Puppeteer...
  await page.click("#newtab");

  // Set url
  await page.evaluate(url => {
    document.querySelector("input[name='url']").value = url;
  }, url);

  // Set assignment_id and assignment_title
  await page.evaluate(
    (assignment_id, assignment_title) => {
      document.querySelector("input[name='ext_lti_assignment_id']").value = assignment_id;
      document.querySelector("input[name='resource_link_title']").value = assignment_title;
    },
    assignment_id,
    assignment_title
  );

  await page.click("#launch");

  const pageTarget = page.target();
  const newTarget = await browser.waitForTarget(target => target.opener() === pageTarget);

  const autocheck_teacher_page = await newTarget.page();

  // Configure course

  // await delay(1500);
  await autocheck_teacher_page.waitForFunction(() => window.monaco && window.monaco.editor.getModels().length > 0);
  await autocheck_teacher_page.evaluate(configuration => {
    window.monaco.editor.getModels()[0].setValue(configuration);
  }, fs.readFileSync("./files/Autocheckfile", "utf8"));
  // await delay(1500);

  // Save configuration
  await autocheck_teacher_page.click("#configuration-form button[type='submit']");
  await autocheck_teacher_page.close();

  await browser.close();

  console.log("Assignment configured");

  let browsers = [];
  for (let i = 1; i <= test_count; i++) {
    for (let j = 1; j <= browser_count * i; j++) {
      browsers.push(
        (async () => {
          const browser = await puppeteer.launch(launch_options);
          const page = (await browser.pages())[0];

          page.on("dialog", async dialog => {
            await dialog.accept();
          });

          await page.goto(lti_launcher_url);
          await page.evaluate(url => {
            document.querySelector("select[name='roles']").selectedIndex = 1;
            document.querySelector("input[name='url']").value = url;
          }, url);
          await page.click("#newtab");
          await page.click("#launch");

          const pageTarget = page.target();
          const newTarget = await browser.waitForTarget(target => target.opener() === pageTarget);

          const autocheck_student_page = await newTarget.page();
          await autocheck_student_page.goto(url + "/submission/submit/" + assignment_id);
          await delay(2000);
          const fileInput = await autocheck_student_page.$("input[type=file]");
          await fileInput.uploadFile("./files/sleeper.sh");

          return [browser, autocheck_student_page];
        })()
      );
    }

    const browsers_with_pages = await Promise.all(browsers);

    console.log("Spawned", browsers_with_pages.length, "browsers");

    const measurements = browsers_with_pages.map(async ([_, page]) => {
      await Promise.all([page.click("button[type='submit']"), page.waitForNavigation()]);
      const start = process.hrtime.bigint();
      await page.waitFor("i.green.check.icon", { timeout: 3600 * 1000 });

      const end = process.hrtime.bigint();

      return Number(end - start);
    });

    let all_measurements = Promise.all(measurements).then(measurements => [browser_count * i, measurements]);
    let timeout = delay(100 * 1000).then(() => [browser_count * i, "timeout"]);

    let [num_browsers, result] = await Promise.race([all_measurements, timeout]);

    if (result != "timeout") {
      const median_ns = median(result);
      const mean_ns = mean(result);

      console.log("#browsers=", num_browsers, "median=", median_ns / 1000000, "ms", "mean=", mean_ns / 1000000, "ms", ...result);
    } else {
      console.log("#browsers=", num_browsers, "timeout");
    }

    console.log("Closing", browsers_with_pages.length, "browsers");
    await Promise.all(browsers_with_pages.map(([browser, _]) => browser.close()));

    browsers = [];
  }
})();

function median(array) {
  array.sort((a, b) => a - b);
  var mid = array.length / 2;
  return mid % 1 ? array[mid - 0.5] : (array[mid - 1] + array[mid]) / 2;
}

function mean(array) {
  return array.reduce((sum, value) => sum + value, 0) / array.length;
}
