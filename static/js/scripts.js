window.addEventListener('DOMContentLoaded', event => {
    const generateStoryButton = document.querySelector('.createStory');
    const fetchSearchData = document.querySelector('.search');
    const checkingDiv = document.querySelector('.checking');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const statusSpinner = document.getElementById('statusSpinner');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const successTick = document.getElementById('successTick');

    let currentJobId = null; // Variable to hold the job ID

    if (generateStoryButton) {
        // Disable Button initially
        generateStoryButton.disabled = true;

        generateStoryButton.addEventListener('click', async () => {
            if (!currentJobId) {
                console.error("No job ID available to generate story.");
                statusSpinner.innerHTML = "Error: No Job ID. Please fetch data first.";
                return;
            }

            statusSpinner.innerHTML = "Generating your story... this can take a minute.";
            checkingDiv.style.display = 'block';
            generateStoryButton.disabled = true;
            fetchSearchData.disabled = true;

            try {
                const storyResponse = await fetch(`/generateStory/${currentJobId}`);
                if (!storyResponse.ok) {
                    const errorText = await storyResponse.text();
                    throw new Error(`Failed to generate story: ${errorText}`);
                }
                const storyData = await storyResponse.json();

                // Redirect to the story page
                window.location.href = `/archive/${currentJobId}/${storyData.storyID}`;
            } catch (error) {
                console.error("Error generating story:", error);
                statusSpinner.innerHTML = `Error creating story: ${error.message}`;
                generateStoryButton.disabled = false; // Re-enable on failure
                fetchSearchData.disabled = false;
            }
        });
    }

    if (fetchSearchData) {
        fetchSearchData.addEventListener('click', async function() {
            var startDate = startDateInput.value;
            var endDate = endDateInput.value;

            // Convert to ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ) if a date is selected
            if (startDate !== "") {
                startDate = new Date(startDate).toISOString();
            } else {
                startDate = 0;
            }

            if (endDate !== "") {
                endDate = new Date(endDate).toISOString();
            } else {
                endDate = null;
            }

            checkingDiv.style.display = 'flex';
            loadingSpinner.style.display = 'inline-block';
            successTick.style.display = 'none';
            statusSpinner.innerHTML = "Submitting Job .....";
            fetchSearchData.disabled = true;
            generateStoryButton.disabled = true;

            try {
                const response = await fetch(`/submitDataJob/myactivity.search/${startDate}/${endDate}`);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to submit job: ${errorText}`);
                }
                const data = await response.json();
                const jobId = data.jobId;
                currentJobId = jobId; // Store the job ID

                statusSpinner.innerHTML = "Checking Job ..... Waiting";

                const pollInterval = setInterval(async () => {
                    try {
                        const checkResponse = await fetch(`/checkJob/${jobId}`);
                        if (!checkResponse.ok) {
                            throw new Error('Polling checkJob failed');
                        }
                        const jobStatus = await checkResponse.json();

                        if (jobStatus.state === 'COMPLETE') {
                            clearInterval(pollInterval);
                            statusSpinner.innerHTML = "Job Complete. Fetching data...";

                            const getDataResponse = await fetch(`/getData/${jobId}`);
                            if (!getDataResponse.ok) {
                                throw new Error('Failed to get data');
                            }
                            await getDataResponse.text(); // Wait for it to complete

                            loadingSpinner.style.display = 'none';
                            successTick.style.display = 'inline-block';
                            statusSpinner.innerHTML = "Data Download Complete. You can now create a story.";
                            generateStoryButton.disabled = false;
                            fetchSearchData.disabled = true; // Re-enable fetch button

                        } else if (jobStatus.state === 'FAILED' || jobStatus.state === 'EXPIRED') {
                            clearInterval(pollInterval);
                            loadingSpinner.style.display = 'none';
                            statusSpinner.innerHTML = `Job failed with state: ${jobStatus.state}`;
                            fetchSearchData.disabled = false;
                        } else {
                            statusSpinner.innerHTML = `Checking Job ..... Waiting for API`
                        }
                    } catch (pollError) {
                        clearInterval(pollInterval);
                        console.error('Error during polling:', pollError);
                        loadingSpinner.style.display = 'none';
                        statusSpinner.innerHTML = "An error occurred while checking job status.";
                        fetchSearchData.disabled = false;
                    }
                }, 5000);

            } catch (error) {
                console.error('Error in job submission:', error);
                statusSpinner.innerHTML = `An error occurred: ${error.message}`;
                checkingDiv.style.display = 'none';
                fetchSearchData.disabled = false;
            }
        });
    }
});
