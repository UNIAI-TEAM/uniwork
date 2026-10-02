# Cursor Cloud Agent base image for a repository-level environment
# (.cursor/environment.json). The toolchain and services come from
# .cursor/cloud/provision.sh, the same script a saved environment's install
# step runs, so both paths stay identical. Versions live in that script.
FROM ubuntu:24.04

ENV LANG=C.UTF-8 TZ=Asia/Ho_Chi_Minh

COPY cloud/provision.sh /tmp/provision.sh
RUN bash /tmp/provision.sh && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/provision.sh

# The agent works as the image's stock non-root user with passwordless sudo,
# so start.sh can start the system services.
RUN echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
 && chmod 0440 /etc/sudoers.d/ubuntu \
 && chown ubuntu:ubuntu /var/lib/minio

USER ubuntu
ENV PATH=/usr/local/go/bin:/home/ubuntu/go/bin:$PATH
WORKDIR /home/ubuntu
