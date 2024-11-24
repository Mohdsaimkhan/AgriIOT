#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>

#include <cuda_runtime.h>
#include <sndfile.h>

typedef float DTYPE;

#define SHARED_MEM_SIZE 256
#define SAMPLING_FREQUENCY 44100
#define CARRIER_FREQUENCY 12800

bool loadAudioFile(const char *file_path, DTYPE **audio_data, unsigned int *audio_size)
{
    SNDFILE *snd_file;
    SF_INFO sf_info;

    snd_file = sf_open(file_path, SFM_READ, &sf_info);
    if (!snd_file)
    {
        fprintf(stderr, "Error opening file: %s\n", file_path);
        return false;
    }

    DTYPE host_filter_coeff[FILTER_LENGTH];
    designLowPassFilter(host_filter_coeff, FILTER_LENGTH, CUTOFF_FREQUENCY);

    *audio_size = sf_info.frames * sf_info.channels;
    *audio_data = (DTYPE *)malloc(sizeof(DTYPE) * (*audio_size));

    sf_readf_float(snd_file, *audio_data, *audio_size);
    sf_close(snd_file);

    return true;
}

void saveAudioFile(const char *file_path, DTYPE *audio_data, unsigned int audio_size, unsigned int sample_rate)
{
    SNDFILE *snd_file;
    SF_INFO sf_info;

    sf_info.samplerate = sample_rate;
    sf_info.channels = 1; // Assuming mono audio
    sf_info.format = SF_FORMAT_WAV | SF_FORMAT_PCM_16;

    snd_file = sf_open(file_path, SFM_WRITE, &sf_info);
    sf_writef_float(snd_file, audio_data, audio_size);
    sf_close(snd_file);
}

__global__ void processAudio(DTYPE *input_audio, DTYPE *output_audio, unsigned int audio_size, bool encrypt)
{
    int tid = threadIdx.x + blockIdx.x * blockDim.x;

    for (int i = tid; i < audio_size; i += blockDim.x * gridDim.x)
    {
        if (encrypt)
        {
            output_audio[i] = sin(2.0 * M_PI * CARRIER_FREQUENCY * i / SAMPLING_FREQUENCY) * input_audio[i];
        }
        else
        {
            if (sin(2.0 * M_PI * CARRIER_FREQUENCY * i / SAMPLING_FREQUENCY) != 0)
            {
                output_audio[i] = input_audio[i] / sin(2.0 * M_PI * CARRIER_FREQUENCY * i / SAMPLING_FREQUENCY);
            }
        }
    }
}

int main(int argc, char **argv)
{
    if (argc != 4)
    {
        fprintf(stderr, "Usage: %s <cypher|decypher> <input.wav> <output.wav>\n", argv[0]);
        return EXIT_FAILURE;
    }

    const char *mode = argv[1];
    const char *input_file = argv[2];
    const char *output_file = argv[3];

    DTYPE *h_input_audio, *h_output_audio;
    unsigned int audio_size;

    if (!loadAudioFile(input_file, &h_input_audio, &audio_size))
    {
        fprintf(stderr, "Error loading input audio file\n");
        return EXIT_FAILURE;
    }

    h_output_audio = (DTYPE *)malloc(sizeof(DTYPE) * audio_size);

    DTYPE *d_input_audio, *d_output_audio ,*d_filter_coeff;;
    cudaMalloc((void **)&d_input_audio, sizeof(DTYPE) * audio_size);
    cudaMalloc((void **)&d_output_audio, sizeof(DTYPE) * audio_size);
    

    cudaMemcpy(d_input_audio, h_input_audio, sizeof(DTYPE) * audio_size, cudaMemcpyHostToDevice);

    unsigned int threads_per_block = 256;
    unsigned int num_blocks = (audio_size + threads_per_block - 1) / threads_per_block;

    processAudio<<<num_blocks, threads_per_block>>>(d_input_audio, d_output_audio, audio_size, strcmp(mode, "cypher") == 0);

    cudaDeviceSynchronize();

    cudaMemcpy(h_output_audio, d_output_audio, sizeof(DTYPE) * audio_size, cudaMemcpyDeviceToHost);

    saveAudioFile(output_file, h_output_audio, audio_size, SAMPLING_FREQUENCY);

    free(h_input_audio);
    free(h_output_audio);

    cudaFree(d_input_audio);
    cudaFree(d_output_audio);

    return EXIT_SUCCESS;
}
