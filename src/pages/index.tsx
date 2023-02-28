import React, { useEffect, useRef, useState } from "react";

import { useIsomorphicLayoutEffect } from "usehooks-ts";

import { supabase } from "../supabaseClient";
import { useUser } from "@supabase/auth-helpers-react";
import Router from "next/router";
import JSZip from "jszip";

import styles from "./Home.module.css";
import Header from "../components/Header";
import classNames from "classnames";

const BASETEN_PROJECT_ROUTE = "https://app.baseten.co/routes/XXXXXXX";
const FINETUNING_BUCKET = "fine-tuning-bucket"; // Update to the bucket name you chose on Supabase Storage

async function post(url: string, body: any, callback: any) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((response) => response.json())
    .then(callback);
}

function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  // Remember the latest callback if it changes.
  useIsomorphicLayoutEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval.
  useEffect(() => {
    // Don't schedule if no delay is specified.
    // Note: 0 is a valid value for delay.
    if (!delay && delay !== 0) {
      return;
    }

    const id = setInterval(() => savedCallback.current(), delay);

    return () => clearInterval(id);
  }, [delay]);
}

export default function Home() {
  const user = useUser();
  const [ready, setReady] = useState(false);
  const [fineTuningData, setFinetuningData] = useState({
    dataset: null,
    run_id: null,
    run_data: {
      status: null,
    },
  });

  const [modelStatus, setModelStatus] = useState({
    healthy: null,
    modelId: null,
  });
  const [instancePrompt, setInstancePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [queueingFinetuning, setQueueingFinetuning] = useState(false);
  const [instanceName, setInstanceName] = useState("");

  useEffect(() => {
    if (!user) {
      Router.push("/login");
    }
  }, [user]);

  useEffect(() => {
    const fetchData = async () => {
      if (user) {
        getOrInsertUserData(user);
        getModelStatus(user);
      }
    };

    fetchData();
  }, [user]);

  useInterval(() => getOrInsertUserData(user), 10000);
  useInterval(() => getModelStatus(user), 10000);

  async function clearUserData(user: any) {
    post(
      `${BASETEN_PROJECT_ROUTE}/clear_user_data`,
      { user_id: user?.id },
      (data: any) => setFinetuningData(data.output)
    );
  }

  async function getOrInsertUserData(user: any) {
    await fetch(`${BASETEN_PROJECT_ROUTE}/user_data?user_id=${user.id}`)
      .then((response) => response.json())
      .then((data) => setFinetuningData(data.output));
    setReady(true);
  }

  async function getModelStatus(user: any) {
    await fetch(`${BASETEN_PROJECT_ROUTE}/model_status?user_id=${user.id}`)
      .then((response) => response.json())
      .then((data) =>
        setModelStatus({
          modelId: data.output.model_id,
          healthy: data.output.healthy,
        })
      );

    setReady(true);
  }

  async function handleFileUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    setUploading(true);
    const zip = new JSZip();
    const files = ev.target.files || [];
    const folder = zip.folder("dataset")?.folder("object");
    if (folder) {
      for (let file = 0; file < files.length; file++) {
        folder.file(files[file].name, files[file]);
      }
    }

    zip.generateAsync({ type: "blob" }).then(async (content) => {
      try {
        await supabase.storage
          .from(FINETUNING_BUCKET)
          .remove([`public/${user?.id}`]);
      } catch (error) {
        console.log(error);
      }

      const { data } = await supabase.storage
        .from(FINETUNING_BUCKET)
        .upload(`public/${user?.id}`, content);

      if (data) {
        await supabase
          .from("finetuningruns")
          .update({ dataset: `public/${user?.id}` })
          .eq("user_id", user?.id)
          .select();
        getOrInsertUserData(user);
      }

      setUploading(false);
    });
  }

  async function handleValidationAndFinetuningStart() {
    setQueueingFinetuning(true);
    await post(
      `${BASETEN_PROJECT_ROUTE}/fine_tune_model`,
      {
        url: fineTuningData.dataset,
        prompt: instanceName,
        user_id: user?.id,
      },
      (data: any) => console.log(data)
    );
    getOrInsertUserData(user);
    setQueueingFinetuning(false);
  }

  async function handleCallModel() {
    post(
      `${BASETEN_PROJECT_ROUTE}/call_model`,
      {
        run_id: fineTuningData.run_id,
        instance_prompt: instancePrompt,
      },
      (data: any) => {
        const {
          output: { url },
        } = data;
        setImageUrl(url);
      }
    );
  }

  const hasUploadedData = !!fineTuningData?.dataset;
  const hasFinetunedModel = !!fineTuningData?.run_id;
  const runStatus = fineTuningData?.run_data?.status;
  const itemButton = useRef<HTMLInputElement>(null);
  const fineTuningInProgress =
    runStatus === "RUNNING" || runStatus === "PENDING";
  const fineTuningFailed = runStatus === "FAILED";

  return (
    <>
      <Header />
      {ready && (
        <>
          <main className={styles.main}>
            <div
              className={classNames(styles.step, {
                [styles.complete]: hasUploadedData,
              })}
            >
              <div>
                <div className={styles.stepheading}>Upload data</div>
                <div>
                  Select some images to start fine tuning Stable Diffusion.
                </div>

                {!hasUploadedData && (
                  <>
                    <input
                      type="file"
                      id="files"
                      className={styles.hidden}
                      multiple
                      onChange={handleFileUpload}
                      ref={itemButton}
                    />
                    <label htmlFor="files">
                      <button
                        className={classNames([
                          styles.button,
                          styles.primary,
                          {
                            [styles.inactive]: uploading,
                          },
                        ])}
                        onClick={() =>
                          !uploading && itemButton.current?.click()
                        }
                        disabled={uploading}
                      >
                        Upload data
                      </button>
                    </label>
                  </>
                )}
              </div>
            </div>

            <div
              className={classNames(styles.step, {
                [styles.ineligible]: !hasUploadedData,
                [styles.complete]: hasFinetunedModel,
                [styles.blinker]: fineTuningInProgress,
                [styles.failed]: fineTuningFailed,
              })}
              style={{ marginBottom: 0 }}
            >
              <div>
                <div className={styles.stepheading}>Fine tune the model</div>
                <div>Start fine tuning your model to the selected data.<br />Give the object you are fine-tuning for an unique name (e.g. Olliedog).</div>
                <div
                  className={classNames(styles.finetuningsection, {
                    [styles.hidden]: hasFinetunedModel || !hasUploadedData,
                  })}
                >
                  <input
                    className={styles.instance}
                    value={instanceName}
                    onChange={(ev) => setInstanceName(ev.target.value)}
                    placeholder={"Unique instance name"}
                  />
                  <button
                    disabled={
                      instanceName.length === 0 ||
                      hasFinetunedModel ||
                      queueingFinetuning
                    }
                    onClick={handleValidationAndFinetuningStart}
                    className={classNames(styles.button, styles.primary)}
                    style={{
                      marginLeft: "8px",
                      pointerEvents:
                        instanceName.length === 0 ||
                        hasFinetunedModel ||
                        queueingFinetuning
                          ? "none"
                          : "inherit",
                    }}
                  >
                    🪄 Tune
                  </button>
                </div>
              </div>
            </div>
          </main>

          {modelStatus.healthy && (
            <main className={styles.main}>
              <div className={classNames(styles.step, styles.columnstep)}>
                <div className={styles.prompt}>
                  <input
                    className={classNames(styles.input, styles.promptinput)}
                    value={instancePrompt}
                    onChange={(e) => setInstancePrompt(e.target.value)}
                    placeholder="Image generation prompt, e.g. Olliedog in warhol style"
                  />
                  <button
                    onClick={handleCallModel}
                    className={classNames(styles.button, styles.primary)}
                    style={{ marginTop: 0 }}
                  >
                    Image me!
                  </button>
                </div>
                {imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={classNames(styles.image, styles.modeloutput)}
                    alt="Generated image"
                    width={400}
                    height={400}
                    src={imageUrl}
                  />
                )}
              </div>
            </main>
          )}

          <main className={styles.main}>
            <div className={styles.clear}>
              <button
                onClick={() => clearUserData(user)}
                className={classNames(styles.button, styles.reset)}
              >
                Start again
              </button>
            </div>
          </main>
        </>
      )}
    </>
  );
}
