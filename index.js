const puppeteer = require("puppeteer");
const path = require("path");
const uuidv4 = require("uuid/v4");

const assignment_title = "Benchmark";
const assignment_id = uuidv4();

function delay(timeout) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

const lti_launcher_url = `file:${path.join(__dirname, "../server/lti_launcher/index.html")}`;

(async () => {
  let browser = await puppeteer.launch({ headless: false });
  let [page] = await browser.pages();

  page.on("dialog", async dialog => {
    await dialog.accept();
  });

  await page.goto(lti_launcher_url);

  // Make sure that the Autocheck page opens in a new tab.
  // I can't imagine how cumbersome it would be to work with an iframe in Puppeteer...
  await page.click("#newtab");

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
  await delay(500);
  const autocheck_teacher_page = (await browser.pages())[1];

  // Configure course

  await autocheck_teacher_page.evaluate(() => {
    document.querySelector("#dsl").value = `
      @env "elixir",
        version: "1.7"

      step "Run sleeper" do
        run "chmod +x sleeper.sh"
        run "./sleeper.sh"
      end
    `;
  });

  // Save configuration
  await autocheck_teacher_page.click("#configuration-form button[type='submit']");
  await autocheck_teacher_page.close();

  // Now auth as student
  await page.evaluate(() => {
    document.querySelector("select[name='roles']").selectedIndex = 1;
  });

  await page.click("#launch");
  await delay(500);

  const autocheck_student_page = (await browser.pages())[1];
  await autocheck_student_page.close();

  let start = new Date();

  const pages = [];

  for (let i = 0; i < 5; i++) {
    pages.push(
      browser.newPage().then(async page => {
        await page.goto("https://localhost:4001/submission/submit/" + assignment_id);
        const fileInput = await page.$("input[type=file]");
        await fileInput.uploadFile("./files/sleeper.sh");

        await page.click("button[type='submit']");
        await page.waitFor("i.green.check.icon");
        await page.close();
      })
    );
  }

  await Promise.all(pages);

  let end = new Date();

  console.log("This took", end - start, "ms");

  await browser.close();
})();
