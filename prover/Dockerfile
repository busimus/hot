FROM golang:1.19

WORKDIR /prover_build
COPY main.go idena.go vrf.go go.sum go.mod /prover_build/
RUN mkdir /prover_build/edwards25519
COPY edwards25519 /prover_build/edwards25519

RUN go build .

FROM debian:buster-slim
COPY --from=0 /prover_build/prover ./
RUN adduser -u 6789 --disabled-password --gecos "" proveruser && chown -R proveruser /prover
USER proveruser

CMD [ "/prover", "run" ]
