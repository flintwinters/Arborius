all:
	gcc market.cpp -lsfml-graphics -lsfml-system -lsfml-window -lstdc++ -lm -g -o outmarket;
	./outmarket;
